/* Supabase 連線設定（見 README 步驟一-6）
   anon key 設計上就是公開的，資料安全由資料庫的 RLS 權限保護。
   ⚠ 絕對不要放 service_role key。 */
window.APP_CONFIG = {
  // 平台名稱：顯示在頁面上方、商品頁與研究者後台。想改名稱只要改這兩行（BRAND_EN 可留空）。
  BRAND_ZH: "碩士論文問卷",
  BRAND_EN: "",

  // ★ 測試模式：true = 用瀏覽器本機模擬資料庫（不需 Supabase）。正式上線前改成 false！
  DEMO_MODE: true,
  DEMO_FAST: true,     // 測試模式下，把到貨頁/決策頁的等待縮短為 3 秒

  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY"
};

