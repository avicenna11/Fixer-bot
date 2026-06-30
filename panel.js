const express = require("express");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static("."));

let botRunning = false;

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/panel.html");
});

app.post("/save", (req, res) => {
  const newSettings = req.body;
  const oldSettings = JSON.parse(fs.readFileSync("settings.json"));

  const merged = { ...oldSettings, ...newSettings };
  fs.writeFileSync("settings.json", JSON.stringify(merged, null, 2));

  res.send("OK");
});

app.get("/start", (req, res) => {
  botRunning = true;
  res.send("Bot Started");
});

app.get("/stop", (req, res) => {
  botRunning = false;
  res.send("Bot Stopped");
});

// پورت درست برای Render
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`PANEL READY → Listening on port ${PORT}`);
});

module.exports = { botRunning };
