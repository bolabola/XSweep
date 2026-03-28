# XSweep

XSweep is a smart, powerful, and privacy-first X (Twitter) unfollow manager extension for Google Chrome. It allows you to efficiently manage your following list with precision filters, speed control, and batch actions.

## Features

- **Smart Filters:** Instantly filter users based on days inactive, follower amount, and more.
- **Protect Accounts:** Never accidentally unfollow your favorite accounts or mutuals (Protect Follow-back feature).
- **Speed Control:** Choose your unfollow speed directly (Slow, Normal, Fast) to protect your account from rate limits.
- **Privacy-first:** XSweep runs 100% locally in your browser. Authentication tokens and your data are never sent to external servers. It operates exclusively through the official X API via your active session.
- **Sleek UI:** Modern, compact, and beautiful user interface.

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click on **Load unpacked** in the top left corner.
5. Select the folder containing the `manifest.json`.

## Usage

1. Open X (Twitter) and ensure you are logged in.
2. Go to your own profile page (`https://x.com/your_handle`).
3. Click the **XSweep** button injected on your profile.
4. Set up your desired filters and click **Preview** to review who will be unfollowed.
5. Click **Unfollow All** to execute the batch unfollow based on your rules.

## Store Publication Requirements
Before publishing to the Chrome WebStore, make sure you:
1. Include `icon16.png`, `icon48.png`, and `icon128.png` in the `icons/` directory.
2. Have screenshots of the dashboard.
3. Zip the entire directory.
4. Publish under your developer account.

## License

This project is licensed under the MIT License.
