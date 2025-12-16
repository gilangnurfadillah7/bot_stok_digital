# CHANGELOG

## v1.1.0 - UX Hardening and Critical Bug Fixes

This release focuses on improving the bot's robustness in a multi-admin environment, preventing data corruption, and significantly enhancing the user experience for non-technical administrators.

### 🐛 Bug Fixes & 🛡️ Hardening

*   **Critical State Isolation Fix:** Implemented per-chat state management for `pendingInputs` and `restockBuffers`. The global `.clear()` in the `HOME` action has been replaced with targeted `.delete(chatId)`. This prevents Admin A's actions from corrupting or resetting Admin B's in-progress flow.
*   **State Leakage Prevention:** Added logic to clear `pendingInputs` at the start of `handleCallback`. This ensures that any button click (even 'Back' or 'Cancel') correctly resets the expectation for the next text message, preventing unrelated messages from triggering sensitive actions (e.g., order creation).
*   **Race-Safe Restock Deduplication:** Modified the `RESTOCK_CONFIRM` flow to re-run the account identity deduplication check immediately before the final write operation (`gasClient.restockAccounts`). This closes the race window and prevents two concurrent restock operations from adding the same account identity to the stock.
*   **Idempotency for Critical Actions:** Implemented checks and UX improvements for `ORDER_SENT`, `ORDER_REPLACE`, `RENEW_CONFIRM`, and `RENEW_SKIP`. The bot now acknowledges the callback immediately and relies on the service layer to prevent double mutation. If an action is already complete, the bot returns a specific "already processed" message.

### ✨ UX Improvements

*   **No Stale Buttons:** Implemented logic to remove or disable the inline keyboard (`editMessageReplyMarkup`) after a button click has completed a step in a multi-step wizard (e.g., `ORDER_NEW`, `ORDER_CH`, `ORDER_PICK`, `RESTOCK`). This prevents non-technical admins from misclicking old buttons and re-triggering stale flows.
*   **Clear Error UX:** Enhanced error handling in `telegramController.handleUpdate` and `handleCallback`. All critical errors (e.g., service failures, unauthorized access) now trigger a persistent `sendMessage` to the chat, in addition to the transient Telegram toast (`answerCallbackQuery`), ensuring the admin is clearly informed of the failure.
*   **Improved Restock Flow:** The `RESTOCK_ACCOUNTS` flow now correctly maintains the `pendingInputs` state across multiple text messages until `/selesai` is sent, allowing for multi-message input as requested.
