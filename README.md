# 線上服飾購物情境實驗平台（GitHub Pages + Supabase）

## 零、先在自己電腦測試（不需要任何帳號）

預設就是**測試模式**（`config.js` 的 `DEMO_MODE: true`），用瀏覽器本機模擬資料庫。

1. 把壓縮檔解壓縮到同一個資料夾。
2. 用 Chrome 或 Edge 直接雙擊開啟 `admin.html`。
   研究者帳號：`demo@demo.com`　密碼：`demo1234`。
3. 在後台按「產生」建立 ID（也已內建 8 個測試 ID，如 `TEST0001-xxxx`）。
4. 開 `index.html`（可開無痕視窗模擬另一位受試者），輸入 ID 登入，從頭走完流程。
5. 回後台按「重新整理」，確認組別、進度、停留秒數有出現，再試「匯出 CSV」。
6. 測試重點：
   - 輸入不存在的 ID → 應顯示錯誤。
   - 中途重新整理 → 應回到原本進度。
   - 完成後再用同一 ID 登入 → 應被拒絕。
   - 連續用 4 個 ID 登入 → 四組各分到 1 人（自動平衡）。
   - 受試者身分開 `admin.html` → 必須登入研究者帳號。
7. 只想看畫面、不登入：`index.html?admin=1&group=C`（可切換任一頁與任一組，不寫入資料）。
8. 想測 Google 表單嵌入：在 `index.html` 最上方 `CONFIG.forms` 貼上表單網址即可，不必等資料庫。
9. 想從頭再測：頁面最上方黃色橫幅的「清除測試資料」。

⚠ 測試模式的資料只存在該瀏覽器，換瀏覽器或換電腦看不到；**正式上線前務必把 `config.js` 的 `DEMO_MODE` 改成 `false`**，並填入 Supabase 金鑰。

---

架構：網頁放 **GitHub Pages**（您的網址），資料庫與登入權限用 **Supabase**（免費）。

| 檔案 | 用途 |
|---|---|
| `index.html` | 填答者頁面：ID 登入 → 實驗流程 → 嵌入 Google 表單 |
| `admin.html` | 研究者後台：登入、產生 ID、查看進度、匯出 CSV |
| `config.js` | 平台名稱、測試模式開關、Supabase 連線設定 |
| `demo-backend.js` | 測試模式用的本機模擬資料庫（正式上線後不會被使用） |
| `schema.sql` | 資料表、角色與權限（步驟一-2 貼到 Supabase 執行） |

## 一、Supabase 設定（約 10 分鐘）

1. 到 https://supabase.com 註冊 → **New project**（記住資料庫密碼；區域選 Singapore 或 Tokyo）。
2. 左側 **SQL Editor** → **New query** → 把 `schema.sql` 全部貼上 → **Run**。
3. **Authentication → Sign In / Providers**，開啟 **Anonymous sign-ins**（填答者以匿名身分登入，靠 ID 辨識）。
4. **Authentication → Users → Add user → Create new user**：輸入您的 Email 與密碼，勾選 **Auto Confirm User**。
5. 回 SQL Editor 執行（Email 換成您剛建立的）：
   ```sql
   insert into public.profiles (user_id, role)
   select id, 'researcher' from auth.users where email = 'you@example.com'
   on conflict (user_id) do update set role = 'researcher';
   ```
6. **Project Settings → API**（或 Connect）複製 **Project URL** 與 **anon public** key，貼進 `config.js`，並把 `DEMO_MODE` 改成 `false`。
   ⚠ 不要使用 `service_role` key。

## 二、放上 GitHub（約 5 分鐘）

1. https://github.com → **New repository**，名稱例如 `experiment-platform`，選 Public → Create。
2. **Add file → Upload files**，把 `index.html`、`admin.html`、`config.js`、`demo-backend.js`、`schema.sql`、`README.md` 全部拖進去 → **Commit changes**。
3. **Settings → Pages → Build and deployment**：Source 選 **Deploy from a branch**，Branch 選 `main` / `(root)` → Save。
4. 1–2 分鐘後網址完成：
   - 填答者：`https://<您的帳號>.github.io/experiment-platform/`
   - 研究者：`https://<您的帳號>.github.io/experiment-platform/admin.html`

## 三、設定 Google 表單

打開 `index.html`，修改最上方 `CONFIG.forms`（三份表單的網址與 entry 編號）。
表單內建立「受試者編號」「組別代碼」兩個簡答題，用「取得預先填入的連結」查出 entry 編號。
受試者編號會自動預填，與資料庫的 ID 完全一致，可用來合併資料。

## 四、日常使用

1. 開 `admin.html` 登入 → **產生參與者 ID**（例如 100 個）→ 複製後分別發給受試者。
2. 受試者開實驗網址，輸入自己的 ID 登入。第一次登入時，資料庫自動分派組別（四組人數自動平衡）。
3. 受試者中途離開，用同一個 ID 重新登入即可從中斷處繼續；完成後的 ID 不能再登入。
4. 後台可看每個 ID 的組別、進度、停留秒數，並匯出 CSV。
5. 預覽平台：後台的「預覽平台」按鈕（或網址加 `?admin=1&group=A`），可切換任一頁與任一組，**不會寫入任何資料**。

## 五、權限設計

| | 研究者 | 填答者 |
|---|---|---|
| 登入方式 | Email + 密碼（`admin.html`） | 參與者 ID（`index.html`） |
| 查看所有紀錄 / 匯出 | 可以 | 不可以 |
| 產生、刪除未使用 ID | 可以 | 不可以 |
| 讀寫自己的紀錄 | － | 只能讀自己的一列，進度只能透過限定函式更新 |
| 自行改組別、改 ID | － | 不可以（資料庫不開放直接寫入） |
| 在填答頁登入 | 研究者登入狀態會先被登出，再以填答者身分進入（研究者帳號不會被綁到受試者紀錄） | － |

研究者身分只存在資料庫的 `profiles` 表，網頁無法自行升級權限；即使有人自行註冊 Email 帳號，也不會是研究者。

## 注意

- Supabase 免費專案**閒置 7 天會自動暫停**，收案期間請定期開後台，或升級付費方案。
- 持有他人 ID 的人可登入並接續未完成的作答，請把 ID 當成私密資料個別發送。
- 若將來需要紀錄問卷「每題答案」於同一資料庫，需把量表改為自建頁面；目前問卷答案存在 Google 表單。

