# XSweep

XSweep is a smart, powerful, and privacy-first X (Twitter) management extension for Google Chrome. It helps you efficiently manage your following list and timeline with precision filters, batch actions, and one-click blocking.

## Features

### Following Management
- **Smart Filters:** Filter users by days inactive (including replies & retweets), follower count, and more.
- **Protect Accounts:** Never accidentally unfollow your favorite accounts or mutuals (Protect Follow-back).
- **Speed Control:** Choose your unfollow speed (Very Slow, Slow, Normal, Fast) to stay within rate limits.
- **Batch Unfollow with Stop:** Start a batch unfollow and stop it at any time with a single click.
- **Undo Unfollow:** Unfollowed users stay in the preview list with a "Follow" button, allowing you to re-follow immediately if you made a mistake.
- **Preview with Profiles:** Click any user's avatar in the preview list to open their profile in a background tab for quick review.

### Timeline Block
- **One-Click Block:** A hidden block button appears next to each tweet author's name when you hover over a tweet. Click it to instantly block the user.
- **Smooth Removal:** Blocked tweets fade out from your timeline with a confirmation toast.
- **Non-intrusive:** The block button stays invisible until you hover, keeping your timeline clean.

### General
- **Privacy-first:** XSweep runs 100% locally in your browser. Authentication tokens and your data are never sent to external servers. It operates exclusively through the official X API via your active session.
- **Sleek UI:** Modern, compact, and beautiful user interface. The XSweep button sits inline next to your Following/Followers stats for quick access.

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click on **Load unpacked** in the top left corner.
5. Select the folder containing the `manifest.json`.

## Usage

### Batch Unfollow
1. Open X (Twitter) and ensure you are logged in.
2. Go to your own profile page (`https://x.com/your_handle`).
3. Click the **XSweep** button next to your Following count.
4. Set up your desired filters and click **Preview** to review who will be unfollowed.
5. Click **Unfollow All** to execute the batch unfollow based on your rules.
6. Click **Stop** at any time to halt the batch process.
7. Use the **Follow** button on any unfollowed user to re-follow them.

### Timeline Block
1. Browse your timeline as usual.
2. Hover over any tweet to reveal the block button (🚫) next to the author's name.
3. Click the button to instantly block the user and remove their tweet from view.

## Store Publication Requirements

Before publishing to the Chrome WebStore, make sure you:
1. Include `icon16.png`, `icon48.png`, and `icon128.png` in the `icons/` directory.
2. Have screenshots of the dashboard.
3. Zip the entire directory.
4. Publish under your developer account.

## License

This project is licensed under the MIT License.
