/** Settings › About: what this is, which build, and the two guarantees. */
import { PRODUCT_NAME, PRODUCT_VERSION } from "../../lib/product";
import Icon from "../../ui/icons";
import { Row, Section } from "./ui";

export default function About() {
  return (
    <>
      <Section title={PRODUCT_NAME} description="Income tax notices, demands, filed returns and filed forms for every client of a chartered accountancy firm, collected from the portal and kept in one encrypted book.">
        <Row label="Version"><span className="mono">{PRODUCT_VERSION}</span></Row>
        <Row label="Portal access"><span className="row"><Icon name="shield" className="faint" />Read-only. The app never submits, responds, uploads or pays.</span></Row>
        <Row label="Dates"><span>Nothing is ever invented. A date the portal does not state is shown as not stated, never estimated.</span></Row>
      </Section>
      <Section title="Modules">
        <Row label="e-Proceedings"><span className="muted">assessments, scrutiny, first appeals, issue letters</span></Row>
        <Row label="Outstanding demands"><span className="muted">amounts payable, the firm's stance, challans</span></Row>
        <Row label="e-Returns filed"><span className="muted">returns with their acknowledgements, revised and updated returns as one thread</span></Row>
        <Row label="e-Forms filed"><span className="muted">statutory forms with their receipts</span></Row>
      </Section>
    </>
  );
}
