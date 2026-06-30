<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>FIXER BOT PANEL</title>
  <style>
    body { background:#111; color:#eee; font-family:Arial; padding:20px; }
    button { padding:10px 20px; margin:10px; font-size:16px; }
    input { padding:8px; margin:5px; width:80px; }
    .box { background:#222; padding:20px; margin-top:20px; border-radius:10px; }
  </style>
</head>
<body>

<h1>FIXER BOT PANEL</h1>

<div class="box">
  <h2>Bot Controls</h2>
  <button onclick="fetch('/start')">Start Bot</button>
  <button onclick="fetch('/stop')">Stop Bot</button>
</div>

<div class="box">
  <h2>Settings</h2>
  <label>TX/day:</label>
  <input id="tx" type="number"><br>

  <label>Min Delay:</label>
  <input id="min" type="number"><br>

  <label>Max Delay:</label>
  <input id="max" type="number"><br>

  <button onclick="save()">Save Settings</button>
</div>

<script>
function save() {
  const data = {
    tx_per_day: Number(document.getElementById("tx").value),
    min_delay: Number(document.getElementById("min").value),
    max_delay: Number(document.getElementById("max").value)
  };

  fetch('/save', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(data)
  });
}
</script>

</body>
</html>