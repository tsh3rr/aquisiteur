import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { FACTURX_FILENAME } from "@/domain/invoices/cii";
import { SRGB_ICC_BASE64 } from "./srgb-icc";

/**
 * Turns the rendered invoice PDF into a Factur-X / ZUGFeRD 2 file (§7.10,
 * ADR-0071): PDF/A-3b with `factur-x.xml` attached as the alternative
 * representation, sRGB output intent and XMP metadata naming the profile.
 * Browser only, loaded with the PDF renderer.
 */

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** XMP with PDF/A-3b identification and the Factur-X extension schema it requires. */
function xmp(meta: { title: string; author: string; date: Date }): string {
  const iso = meta.date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
<pdfaid:part>3</pdfaid:part>
<pdfaid:conformance>B</pdfaid:conformance>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(meta.title)}</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>${xmlEscape(meta.author)}</rdf:li></rdf:Seq></dc:creator>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
<pdf:Producer>Aquisiteur</pdf:Producer>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
<xmp:CreatorTool>Aquisiteur</xmp:CreatorTool>
<xmp:CreateDate>${iso}</xmp:CreateDate>
<xmp:ModifyDate>${iso}</xmp:ModifyDate>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
<fx:DocumentType>INVOICE</fx:DocumentType>
<fx:DocumentFileName>${FACTURX_FILENAME}</fx:DocumentFileName>
<fx:Version>1.0</fx:Version>
<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
<pdfaSchema:prefix>fx</pdfaSchema:prefix>
<pdfaSchema:property><rdf:Seq>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The type of the hybrid document in capital letters, e.g. INVOICE or ORDER</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the standard applying to the embedded XML document</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded XML document</pdfaProperty:description></rdf:li>
</rdf:Seq></pdfaSchema:property>
</rdf:li></rdf:Bag></pdfaExtension:schemas>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function embedFacturX(
  pdfBytes: ArrayBuffer,
  xml: string,
  meta: { title: string; author: string; date?: Date },
): Promise<Uint8Array> {
  const date = meta.date ?? new Date();
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const context = doc.context;
  doc.setTitle(meta.title, { showInWindowTitleBar: true });
  doc.setAuthor(meta.author);
  doc.setProducer("Aquisiteur");
  doc.setCreator("Aquisiteur");
  doc.setCreationDate(date);
  doc.setModificationDate(date);

  const xmlBytes = new TextEncoder().encode(xml);
  const file = context.register(
    context.flateStream(xmlBytes, {
      Type: "EmbeddedFile",
      Subtype: "text/xml",
      Params: { Size: xmlBytes.length, ModDate: PDFString.fromDate(date) },
    }),
  );
  const spec = context.register(
    context.obj({
      Type: "Filespec",
      F: PDFString.of(FACTURX_FILENAME),
      UF: PDFHexString.fromText(FACTURX_FILENAME),
      EF: { F: file, UF: file },
      Desc: PDFString.of("Factur-X invoice"),
      AFRelationship: "Alternative",
    }),
  );
  const catalog = doc.catalog;
  catalog.set(
    PDFName.of("Names"),
    context.obj({ EmbeddedFiles: { Names: [PDFString.of(FACTURX_FILENAME), spec] } }),
  );
  catalog.set(PDFName.of("AF"), context.obj([spec]));

  const icc = context.register(context.flateStream(bytesOf(SRGB_ICC_BASE64), { N: 3 }));
  catalog.set(
    PDFName.of("OutputIntents"),
    context.obj([
      {
        Type: "OutputIntent",
        S: "GTS_PDFA1",
        OutputConditionIdentifier: PDFString.of("sRGB"),
        Info: PDFString.of("sRGB IEC61966-2.1"),
        DestOutputProfile: icc,
      },
    ]),
  );

  const metadata = context.stream(new TextEncoder().encode(xmp({ ...meta, date })), {
    Type: "Metadata",
    Subtype: "XML",
  });
  catalog.set(PDFName.of("Metadata"), context.register(metadata));
  // PDF/A wants a file identifier in the trailer.
  const id = PDFHexString.of(randomHex(16));
  context.trailerInfo.ID = context.obj([id, id]);
  return doc.save({ useObjectStreams: false });
}
