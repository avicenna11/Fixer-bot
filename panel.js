const express = require("express");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// سرو کردن فایل‌های استاتیک مثل panel.html
app.use(express.static(path.join(__dirname)));

// صفحه اصلی پنل
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "panel.html"));
});

// API ساده برای تست
app.get("/status", (req, res) => {
    res.json({ ok: true, message: "Panel is running" });
});

// پورت Render
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log("Panel running on port " + PORT);
});
