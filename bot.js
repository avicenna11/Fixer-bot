// FINAL BOT — 48 TX/day — 6 wallets — balance-safe — first TX BUY — 20–40 min spacing

require("dotenv").config();
const { ethers } = require("ethers");

const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");

// GAS RULE
const MAX_GAS_ETH = 0.000002;
const GAS_LIMIT   = 180000n;

// Wallets with FIXER ranges
const wallets = [
    { name: "W1", pk: process.env.W1, min: 7000000, max: 8000000 },
    { name: "W2", pk: process.env.W2, min: 4500000, max: 5000000 },
    { name: "W3", pk: process.env.W3, min: 3500000, max: 4000000 },
    { name: "W4", pk: process.env.W4, min: 4000000, max: 4500000 },
    { name: "W5", pk: process.env.W5, min: 5000000, max: 5500000 },
    { name: "W6", pk: process.env.W6, min: 2700000, max: 3000000 }
].map(w => ({
    ...w,
    wallet: new ethers.Wallet(w.pk, provider),
    buys: 0,
    sells: 0,
    netFixer: 0 // BUY → netFixer+, SELL → netFixer-
}));

// Random FIXER amount inside wallet range
function randomFixerAmount(w) {
    return Math.floor(Math.random() * (w.max - w.min + 1)) + w.min;
}

// Gas checker
async function isGasCheapEnough() {
    const fee = await provider.getFeeData();
    const gasPrice = fee.gasPrice || fee.maxFeePerGas;
    const costEth = Number(ethers.formatEther(gasPrice * GAS_LIMIT));
    console.log(⛽ Gas Cost = ${costEth} ETH);
    return costEth <= MAX_GAS_ETH;
}

// Random delay 20–40 minutes
function randomDelayMinutes() {
    return Math.floor(Math.random() * (40 - 20 + 1)) + 20;
}

// Build schedule for 48 TX over ~24h
function buildSchedule() {
    const schedule = [];
    let currentTime = Date.now();

    for (let i = 0; i < 48; i++) {
        const delay = randomDelayMinutes() * 60 * 1000;
        currentTime += delay;
        schedule.push(currentTime);
    }

    return schedule;
}

let schedule = buildSchedule();
let pointer  = 0;

// انتخاب کیف‌پول مناسب برای تراکنش بعدی
function pickWalletForNextTx() {
    const candidates = wallets.filter(w => w.buys + w.sells < 8);

    if (candidates.length === 0) return null;

    const possible = candidates.filter(w => {
        if (w.buys === 0 && w.sells === 0) {
            return true; // اولین تراکنش → BUY
        }
        if (w.netFixer > 0) {
            return true; // باید SELL کند
        }
        if (w.netFixer === 0 && w.buys < 4) {
            return true; // می‌تواند BUY جدید شروع کند
        }
        return false;
    });

    if (possible.length === 0) return null;

    const idx = Math.floor(Math.random() * possible.length);
    return possible[idx];
}

// تعیین نوع تراکنش برای کیف‌پول انتخاب‌شده
function decideActionForWallet(w) {
    if (w.buys === 0 && w.sells === 0) {
        return "BUY"; // اولین تراکنش
    }

    if (w.netFixer > 0) {
        return "SELL"; // باید بالانس را صفر کند
    }

    if (w.netFixer === 0 && w.buys < 4) {
        return "BUY"; // چرخهٔ جدید
    }

    return null;
}

// MAIN LOOP — every 20 seconds
setInterval(async () => {
    const now = Date.now();

    if (pointer >= 48) {
        console.log("🔁 New day — reset wallets & schedule...");
        for (const w of wallets) {
            w.buys = 0;
            w.sells = 0;
            w.netFixer = 0;
        }
        schedule = buildSchedule();
        pointer  = 0;
        return;
    }

    if (now < schedule[pointer]) return;

    const gasOK = await isGasCheapEnough();
    if (!gasOK) {
        console.log("🔴 Gas high, waiting...");
        return;
    }

    const w = pickWalletForNextTx();
    if (!w) {
        console.log("⚪ No wallet available for balanced TX");
        return;
    }

    const action = decideActionForWallet(w);
    if (!action) {
        console.log(⚪ ${w.name} has no valid action left);
        return;
    }

    let amount = randomFixerAmount(w);

    if (action === "SELL" && w.netFixer > 0) {
        if (w.sells === 3) {
            amount = w.netFixer; // صفر کردن بالانس
        } else if (amount > w.netFixer) {
          console.log(
        🚀 TX #${pointer+1} | ${w.name} → ${action} ${amount} FIXER | netFixer(before)=${w.netFixer}
    );

    if (action === "BUY") {
        w.buys++;
        w.netFixer += amount;
    } else {
        w.sells++;
        w.netFixer -= amount;
        if (w.netFixer < 0) w.netFixer = 0;
    }

    console.log(   ➜ netFixer(after)=${w.netFixer}, buys=${w.buys}, sells=${w.sells});

    pointer++;

}, 20 * 1000);

console.log("🚀 BOT READY — first TX BUY, balance-safe, random wallets, 48 TX/day, 20–40 min spacing");
            amount = w.netFixer;
        }
    }
