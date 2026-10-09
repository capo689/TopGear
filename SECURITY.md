# Security policy

Browser Bridge drives a real browser, sometimes with your logins, on behalf of an AI agent.
We treat any way around its safety rules as a security bug. That includes:

- a page's content getting an agent to take an action the grant or the confirmation gate
  should have stopped
- a high-risk action (purchase, delete, send, cross-site submit, sensitive data to another
  origin) running without a daemon-built confirmation
- a secret value reaching model context, logs or error payloads
- anything leaving the machine other than the browser's own page loads
- the extension, native-messaging host or local socket being usable by another local
  process or website

## Reporting a vulnerability

**Please don't open a public issue for a vulnerability.**

Report it privately through GitHub:
[Report a vulnerability](https://github.com/capo689/TopGear/security/advisories/new)
(the repository's **Security** tab → **Report a vulnerability**). If that form isn't
available, open an issue that says only that you have a security report and need a private
contact. Leave out the details.

Please include the version or commit, your setup (isolated or extension mode, OS, Chrome,
MCP client), steps to reproduce, and what you expected to happen. A minimal page that
reproduces the problem helps most.

You should get an acknowledgement within 7 days. We will tell you what we plan to do and
credit you in the fix unless you'd rather not be named.

## Supported versions

This is a developer preview. Only the latest commit on `main` gets fixes.
