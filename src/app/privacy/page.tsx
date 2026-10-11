import { LegalPage } from "../legal-page";
export const metadata = { title: "Privacy Policy", robots: { index: true } };
export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="October 11, 2026">
      <p>AGRON Workspace (the "Service") is the internal operating platform of AGRON Inc., a Delaware corporation ("AGRON", "we"). It is used by AGRON employees and by partners, vendors and investors whom AGRON invites. This policy explains what personal information the Service processes and why.</p>
      <h2>Information we process</h2>
      <ul>
        <li><b>Account information:</b> your name, work email address and, if you sign in with Google, Microsoft or Apple, the basic profile those providers share (name, email address and, where available, profile picture). We request only the "openid", "email" and "profile" permissions. We do not access your email, files, contacts or calendar in those accounts.</li>
        <li><b>Work information:</b> records, comments, files and messages you create in the Service as part of your work with AGRON.</li>
        <li><b>Technical information:</b> sign-in times, IP address and browser information used for security and to keep you signed in.</li>
      </ul>
      <h2>How we use it</h2>
      <p>We use this information only to provide the Service: to authenticate you, apply your access role, show you the records you are allowed to see, send service emails (sign-in codes, reminders and digests), keep audit history and protect the Service against misuse. We do not sell personal information, use it for advertising, or share it with third parties except the service providers listed below.</p>
      <h2>Google user data</h2>
      <p>AGRON Workspace's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Data obtained from Google sign-in is used only to identify you and create your account.</p>
      <h2>Service providers</h2>
      <p>The Service is hosted by Vercel (application), Supabase (database, authentication and file storage), Google Workspace (email delivery) and Anthropic (AI assistant features, which process only the content you send to the assistant). These providers process data on our behalf under contractual confidentiality and security obligations.</p>
      <h2>Retention and security</h2>
      <p>We keep account data while your access is active and remove it within 90 days after access ends, unless law or a legitimate business record requires longer retention. Data is encrypted in transit, access is limited by role, and controlled technical data is restricted to authorized U.S. persons.</p>
      <h2>Your choices</h2>
      <p>You can ask us to access, correct or delete your personal information, or to close your account, by writing to <a href="mailto:info@agron1.com">info@agron1.com</a>. You can also revoke the Service's access from your Google, Microsoft or Apple account settings at any time.</p>
      <h2>Contact</h2>
      <p>AGRON Inc. · <a href="mailto:info@agron1.com">info@agron1.com</a></p>
    </LegalPage>
  );
}
