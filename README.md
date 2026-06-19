# ROK Tech Website

這是「鍵盤撒米科技有限公司 Rice on Keyboard Tech」的靜態電商網站作業。

## 前台頁面

開啟 `index.html` 進入公司網站。前台包含：

- 首頁
- 產品列表
- 商品詳情
- 軟體
- 軟體下載
- 最新資訊
- 商店
- 購物車
- 品牌故事
- 訂單完成頁

## 後台頁面

後台是獨立頁面，不會出現在前台導覽列或頁尾。

- 本機網址：`admin.html`
- GitHub Pages 網址：`https://你的帳號.github.io/你的倉庫名稱/admin.html`
- 展示密碼：`rok1976`

後台可以查看訂單、搜尋訂單、篩選狀態，並把訂單狀態改成「新訂單、處理中、已出貨、已完成、已取消」。也可以按「清除所有訂單」一鍵清空目前瀏覽器中的所有訂單資料。

## 展示流程

1. 打開前台首頁 `index.html`。
2. 到「商店」或「產品」加入商品到購物車。
3. 到「購物車」填姓名、Email、配送方式並送出訂單。
4. 網站會進入「訂單完成」頁，前台不會出現後台入口。
5. 另外手動開啟 `admin.html`。
6. 輸入密碼 `rok1976`。
7. 後台就能看到剛剛建立的訂單。

## GitHub Pages 上架方式

1. 把整個資料夾上傳到 GitHub repository。
2. 到 repository 的 Settings。
3. 找到 Pages。
4. Source 選擇 `Deploy from a branch`。
5. Branch 選 `main`，資料夾選 `/root`。
6. 儲存後等待 GitHub 產生網站網址。

## 注意

這是純靜態網站，訂單資料存在瀏覽器的 localStorage。展示時要用同一個瀏覽器完成下單並打開後台，後台才看得到該瀏覽器建立的訂單。
