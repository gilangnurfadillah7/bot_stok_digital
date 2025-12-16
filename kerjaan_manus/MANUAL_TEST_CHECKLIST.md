# Manual Test Checklist

This checklist is designed to verify the implemented fixes for state isolation, idempotency, race conditions, and UX hardening.

## Setup
1.  Ensure the bot is running and connected to Telegram.
2.  Have two separate Telegram accounts (Admin A and Admin B) authorized to use the bot.
3.  Ensure the Google Sheet backend has at least one active product and some stock available.

## Acceptance Tests (Wajib)

### A) State Isolation (Multi-Admin Safety)
| Step | Admin A Action | Admin B Action | Expected Result | Pass/Fail |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Click '📦 Order Baru' -> '🛒 Shopee' -> Select Product. | Click '📥 Restok Akun' -> Select Product. | Both admins receive the correct next prompt (A: "Pilih durasi", B: "Masukkan daftar akun"). | |
| 2 | Click '❌ Batal' (from duration selection). | Continue restock input (e.g., send 1 account line). | Admin A returns to 'Pilih menu:'. Admin B's restock buffer is **not** cleared. | |
| 3 | Click '📦 Order Baru' -> '🛒 Shopee' -> Select Product -> Select Duration. | Click '❌ Batal' (from restock prompt). | Admin A receives "Masukkan username pembeli". Admin B returns to 'Pilih menu:'. Admin A's pending state is **not** cleared. | |
| 4 | Admin A sends a message (e.g., "buyer_A"). | Admin B sends a message (e.g., "Hello"). | Admin A's order is processed. Admin B's message is ignored, and the Home menu is sent. **Crucially, Admin A's order must not fail.** | |

### B) Idempotency (Anti Double-Click)
| Step | Action | Expected Result | Pass/Fail |
| :--- | :--- | :--- | :--- |
| 1 | Start a new order and complete it. Receive the final message with '✅ Tandai Sudah Dikirim' button. | The message containing the 'Masukkan username pembeli' prompt is edited to remove the keyboard. | |
| 2 | Double-click '✅ Tandai Sudah Dikirim' button rapidly. | The first click marks the order as sent and sends a toast. The second click sends a toast "Order sudah ditandai terkirim" and **does not** cause a second mutation or error. | |
| 3 | Start a '🔁 Akun Bermasalah' flow, select an order, and click '🔄 Minta ganti akun'. | The bot sends the replacement account message. | |
| 4 | Double-click the '🔄 Minta ganti akun' button rapidly. | The first click processes the replacement. The second click sends a toast "Seat sudah diganti" and **does not** cause a second replacement or error. | |
| 5 | Start a '❌ Cancel / Refund' flow, select an order, and send the reason. | The order is cancelled. | |
| 6 | Double-click the '❌ Batalkan Order' button rapidly (from the final order message). | The first click initiates the reason prompt. The second click is ignored or sends a toast "Aksi sedang diproses". | |

### C) Race-Safe Restock Deduplication
| Step | Admin A Action | Admin B Action | Expected Result | Pass/Fail |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Start restock, input `acc1@test.com` and `/selesai`. | Start restock, input `acc1@test.com` and `/selesai`. | Both admins receive the confirmation prompt. Both summaries show 1 account to be added. | |
| 2 | Admin A clicks '✅ Konfirmasi'. | (Wait for A to confirm) | Admin A receives success message. `acc1@test.com` is added to stock. | |
| 3 | Admin B clicks '✅ Konfirmasi'. | | Admin B receives a message: "⚠️ 1 akun baru saja ditambahkan oleh admin lain dan dilewati." The final restock call for Admin B should contain 0 accounts. | |

### D) No Stale Buttons (UX Hardening)
| Step | Action | Expected Result | Pass/Fail |
| :--- | :--- | :--- | :--- |
| 1 | Click '📦 Order Baru' -> '🛒 Shopee'. | The 'Order dari mana?' message is edited to remove the keyboard. | |
| 2 | Click '🌐 Website' (from the 'Order dari mana?' message). | The bot should send a toast "Aksi sudah kadaluarsa atau tidak valid" and **not** proceed to product selection. | |
| 3 | Click '📥 Restok Akun' -> Select Product. | The 'Restok akun untuk produk apa?' message is edited to remove the keyboard. | |
| 4 | Click the product button again from the now-removed keyboard. | The bot should send a toast "Aksi sudah kadaluarsa atau tidak valid" and **not** proceed to the restock prompt. | |

### E) Error UX
| Step | Action | Expected Result | Pass/Fail |
| :--- | :--- | :--- | :--- |
| 1 | Click a button that is expected to fail (e.g., `ORDER_REPLACE` on a non-existent `seat_id` - *requires simulating a service error*). | The bot sends a persistent message to the chat: "❌ Aksi gagal diproses. Silakan coba lagi. Detail error: [Error Message]". A transient toast is also shown. | |
| 2 | Start an order, send buyer ID, and simulate `orderService.createAndAssignSeat` throwing an error (e.g., "Stok habis"). | The bot sends a persistent message to the chat: "❌ Order gagal diproses.\nStok habis." | |

---
**Engineer Note:** The idempotency fix for `ORDER_REPLACE` and `ORDER_SENT` relies on the service layer returning a specific error or status if the action has already been performed. The controller side handles the UX by acknowledging the callback and editing the message to remove the keyboard after the first successful action. The re-deduplication in restock is implemented in the controller.
