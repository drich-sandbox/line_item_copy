# Getting listed on the HubSpot Marketplace

Check HubSpot's current requirements before each step, they change often:
https://developers.hubspot.com/docs/apps/developer-platform/list-apps/listing-your-app/app-marketplace-listing-requirements

## Before you apply
1. App uses OAuth only (it does) and is built on a current platform version (2026.03 is current; HubSpot ships new versions each March and September).
2. Move to the owning email you want long term (a work or company email is best). The listing is tied to that developer account.
3. Get **3 active installs**. An active install is a separate, real HubSpot production account (not yours, not a test account) that used the app in the last 30 days. Ask friends, colleagues, or clients with workflows to install your app. Each needs the install link from HubSpot (Distribution tab) and an admin to approve. You can watch the count in your developer account.
4. Publish a **public setup guide** (a web page explaining how to install and use the action). A GitHub Pages page or a public Notion page works.
5. Publish a **privacy policy** and a **support page or email**. Update `support` in `app-hsmeta.json` to point at them.
6. Replace the `logo` with your final 800x800 image if you have one.
7. Keep the Cloudflare Worker live. Free tier limits are generous, but check them if usage grows.

## Apply
1. Developer account > your app > **Distribution** tab > **Begin publishing** (you already signed the Acceptable Use Policy).
2. Fill in the listing: name, short and long description, categories, screenshots (workflow action in use), setup guide URL, support and privacy links.
3. Submit for review. Expect back and forth with HubSpot reviewers who may ask for changes or test the install flow.
4. Once approved, the app appears in the HubSpot Marketplace.

## Later: certification
Certification (a badge) needs more active installs (currently 60) and six months listed. Not needed to start.
