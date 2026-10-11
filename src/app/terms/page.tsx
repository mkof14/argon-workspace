import { LegalPage } from "../legal-page";
export const metadata = { title: "Terms of Use", robots: { index: true } };
export default function Terms() {
  return (
    <LegalPage title="Terms of Use" updated="October 11, 2026">
      <p>These terms govern the use of AGRON Workspace (the "Service"), operated by AGRON Inc., a Delaware corporation ("AGRON"). By signing in you agree to them.</p>
      <h2>1. Who may use the Service</h2>
      <p>The Service is for AGRON employees and for partners, vendors and investors whom AGRON has invited. Access is granted by role and may be changed or withdrawn by AGRON at any time.</p>
      <h2>2. Your account</h2>
      <p>Keep your sign-in method secure and do not share your account. Tell us promptly at info@agron1.com about any unauthorized use.</p>
      <h2>3. Confidentiality</h2>
      <p>Information in the Service is confidential to AGRON and its partners. Use it only for your work with AGRON and do not disclose it except as your agreements with AGRON allow.</p>
      <h2>4. Export control and sanctions</h2>
      <p>Some technical data in the Service is subject to U.S. export control laws (EAR / ITAR) and sanctions. Records marked "Controlled" may be accessed only by authorized U.S. persons. You must not export, re-export or release such data to any person or country except in compliance with applicable law.</p>
      <h2>5. Acceptable use</h2>
      <p>Do not attempt to access data outside your role, interfere with the Service, upload malicious code, or use the Service for any unlawful purpose.</p>
      <h2>6. AI assistant and documents</h2>
      <p>AI answers and document templates are drafts to support your work. Legal, tax, export-control and regulatory outputs are preliminary and must be confirmed by qualified professionals before you rely on them.</p>
      <h2>7. Availability and changes</h2>
      <p>We work to keep the Service available and secure but provide it "as is" for internal business use. We may change or discontinue features at any time.</p>
      <h2>8. Governing law</h2>
      <p>These terms are governed by the laws of the State of Delaware.</p>
      <h2>9. Contact</h2>
      <p>AGRON Inc. · <a href="mailto:info@agron1.com">info@agron1.com</a></p>
    </LegalPage>
  );
}
