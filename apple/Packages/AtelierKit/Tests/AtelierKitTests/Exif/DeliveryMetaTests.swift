// Port of `src/shared/exif/delivery-meta.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class CaptureYearTests: XCTestCase {
    func testReadsTheYearThePictureWasTaken() {
        XCTAssertEqual(captureYear("2024:11:02 07:12:00", 2026), 2024)
        XCTAssertEqual(captureYear("2024-11-02T07:12:00", 2026), 2024)
    }

    func testFallsBackToTheExportsYearWhenNobodyKnows() {
        XCTAssertEqual(captureYear(nil, 2026), 2026)
        XCTAssertEqual(captureYear("0000:00:00 00:00:00", 2026), 2026)
        XCTAssertEqual(captureYear("garbage", 2026), 2026)
    }
}

final class ResolveRightsTests: XCTestCase {
    func testFillsTheTemplateWithTheYearAndTheName() {
        XCTAssertEqual(
            resolveRights(DeliveryIdentity(creator: "Steeve Pommier", copyright: defaultCopyrightTemplate), 2024),
            DeliveryRights(creator: "Steeve Pommier", copyright: "© 2024 Steeve Pommier. All rights reserved.")
        )
    }

    func testWritesNothingWithoutAName() {
        XCTAssertEqual(
            resolveRights(DeliveryIdentity(creator: " ", copyright: defaultCopyrightTemplate), 2024),
            DeliveryRights(creator: nil, copyright: nil)
        )
        XCTAssertEqual(resolveRights(nil, 2024), DeliveryRights(creator: nil, copyright: nil))
    }

    func testKeepsALineTheAuthorWroteWholePlaceholdersOrNot() {
        XCTAssertEqual(resolveRights(DeliveryIdentity(creator: "S", copyright: "CC BY 4.0"), 2024).copyright, "CC BY 4.0")
        XCTAssertEqual(resolveRights(DeliveryIdentity(creator: "S", copyright: "{year}–{year} {creator}"), 2024).copyright, "2024–2024 S")
    }
}

final class ReadIdentityTests: XCTestCase {
    func testReadsAStoredIdentityAndTheDefaultTemplateForAnEmptyOne() {
        XCTAssertEqual(
            readIdentity(.object(["creator": .string(" Steeve "), "copyright": .string("")])),
            DeliveryIdentity(creator: "Steeve", copyright: defaultCopyrightTemplate)
        )
        XCTAssertEqual(readIdentity(.null), DeliveryIdentity(creator: "", copyright: defaultCopyrightTemplate))
        XCTAssertEqual(readIdentity(nil), emptyIdentity)
    }
}

final class DeliveryXmpTests: XCTestCase {
    func testAlwaysSignsAndSaysTheRestOnlyWhereThereIsSomethingToSay() {
        let bare = deliveryXmp(DeliveryText())
        XCTAssertTrue(bare.contains("xmp:CreatorTool=\"Atelier\""))
        XCTAssertFalse(bare.contains("dc:creator"))
        XCTAssertFalse(bare.contains("xmpRights:Marked"))
        let signed = deliveryXmp(DeliveryText(creator: "A & B", copyright: "© 2024 <A>"))
        XCTAssertTrue(signed.contains("<rdf:li>A &amp; B</rdf:li>"))
        XCTAssertTrue(signed.contains("<rdf:li xml:lang=\"x-default\">© 2024 &lt;A&gt;</rdf:li>"))
        XCTAssertTrue(signed.contains("xmpRights:Marked=\"True\""))
    }

    func testHandsItsDescriptionsToASecondWriterVerbatim() {
        let packet = deliveryXmp(DeliveryText(creator: "S"))
        let inner = xmpDescriptions(packet)
        XCTAssertTrue(inner.hasPrefix("<rdf:Description"))
        XCTAssertTrue(inner.hasSuffix("</rdf:Description>"))
        XCTAssertEqual(xmpDescriptions("not xmp"), "")
    }

    func testEscapesEveryCharacterXmlReserves() {
        XCTAssertEqual(escapeXml("<a href=\"x\">'&'</a>"), "&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;")
    }
}

/// This port's own case: the packet is the BROWSER's, character for character
/// — the golden is `deliveryXmp({ creator, copyright, title, caption, place })`
/// as `delivery-meta.ts` wrote it.
final class DeliveryXmpGoldenTests: XCTestCase {
    func testWritesTheSamePacketAsTheWebModule() {
        let packet = deliveryXmp(DeliveryText(
            creator: "Steeve Pommier",
            copyright: "© 2024 Steeve Pommier. All rights reserved.",
            title: "Pinnacles",
            caption: "Nambung, at dawn — “limestone” & sand",
            place: DeliveryPlace(city: "Cervantes", country: "Australia", countryCode: "AU")
        ))
        XCTAssertEqual(packet, deliveryXmpGolden)
    }

    func testTheContainerFoldsTheSameDescriptionsTheWebFolds() {
        XCTAssertEqual(xmpDescriptions(deliveryXmpGolden), deliveryDescriptionsGolden)
    }
}

// Both printed by the web module (`JSON.stringify`, which is a valid Swift
// literal here: `\"` escapes and the byte-order mark raw).
private let deliveryXmpGolden = "<?xpacket begin=\"﻿\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?><x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Atelier\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"><rdf:Description rdf:about=\"\" xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:xmpRights=\"http://ns.adobe.com/xap/1.0/rights/\" xmlns:photoshop=\"http://ns.adobe.com/photoshop/1.0/\" xmlns:Iptc4xmpCore=\"http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/\" xmp:CreatorTool=\"Atelier\" xmpRights:Marked=\"True\" photoshop:City=\"Cervantes\" photoshop:Country=\"Australia\" Iptc4xmpCore:CountryCode=\"AU\"><dc:creator><rdf:Seq><rdf:li>Steeve Pommier</rdf:li></rdf:Seq></dc:creator><dc:rights><rdf:Alt><rdf:li xml:lang=\"x-default\">© 2024 Steeve Pommier. All rights reserved.</rdf:li></rdf:Alt></dc:rights><dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">Pinnacles</rdf:li></rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li xml:lang=\"x-default\">Nambung, at dawn — “limestone” &amp; sand</rdf:li></rdf:Alt></dc:description></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>"
private let deliveryDescriptionsGolden = "<rdf:Description rdf:about=\"\" xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:xmpRights=\"http://ns.adobe.com/xap/1.0/rights/\" xmlns:photoshop=\"http://ns.adobe.com/photoshop/1.0/\" xmlns:Iptc4xmpCore=\"http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/\" xmp:CreatorTool=\"Atelier\" xmpRights:Marked=\"True\" photoshop:City=\"Cervantes\" photoshop:Country=\"Australia\" Iptc4xmpCore:CountryCode=\"AU\"><dc:creator><rdf:Seq><rdf:li>Steeve Pommier</rdf:li></rdf:Seq></dc:creator><dc:rights><rdf:Alt><rdf:li xml:lang=\"x-default\">© 2024 Steeve Pommier. All rights reserved.</rdf:li></rdf:Alt></dc:rights><dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">Pinnacles</rdf:li></rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li xml:lang=\"x-default\">Nambung, at dawn — “limestone” &amp; sand</rdf:li></rdf:Alt></dc:description></rdf:Description>"
