// FINAL BOT — Aerodrome Pair — FIXER/USDC — 48 TX/day — balance-safe

require("dotenv").config();
const { ethers } = require("ethers");

const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");

// TOKENS & PAIR
const USDC  = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; 
const FIXER = "0x8C3206F89f903638AC74DEEdD9DDC06F0c59C532"; 
const AERO_PAIR = "0x5503D7B01A36B434A9Da15A742aB0649f367A0C5";

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
    netFixer: 0
}));

function randomFixerAmount(w) {
    return Math.floor(Math.random() * (w.max - w.min + 1)) + w.min;
}

async function isGasCheapEnough() {
    const fee = await provider.getFeeData();
    const gasPrice = fee.gasPrice || fee.maxFeePerGas;
    const costEth = Number(ethers.formatEther(gasPrice * GAS_LIMIT));
    console.log(⛽ Gas Cost = ${costEth} ETH);
    return costEth <= MAX_GAS_ETH;
}

function randomDelayMinutes() {
    return Math.floor(Math.random() * (40 - 20 + 1)) + 20;
}

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

// PICK WALLET
function pickWalletForNextTx() {
    const candidates = wallets.filter(w => w.buys + w.sells < 8);
    if (candidates.length === 0) return null;

    const possible = candidates.filter(w => {
        if (w.buys === 0 && w.sells === 0) return true;
        if (w.netFixer > 0) return true;
        if (w.netFixer === 0 && w.buys < 4) return true;
        return false;
    });

    if (possible.length === 0) return null;

    return possible[Math.floor(Math.random() * possible.length)];
}

function decideActionForWallet(w) {
    if (w.buys === 0 && w.sells === 0) return "BUY";
    if (w.netFixer > 0) return "SELL";
    if (w.netFixer === 0 && w.buys < 4) return "BUY";
    return null;
}

// ===== Aerodrome Pair Logic =====

const PAIR_ABI = [
    "function getReserves() view returns (uint112,uint112,uint32)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data)"
];

async function getAmountsOutFromPair(pair, amountIn, tokenIn, tokenOut) {
    const [r0, r1] = await pair.getReserves();
    const t0 = await pair.token0();
    const t1 = await pair.token1();

    let reserveIn, reserveOut;

    if (tokenIn.toLowerCase() === t0.toLowerCase()) {
        reserveIn  = r0;
        reserveOut = r1;
    } else {
        reserveIn  = r1;
        reserveOut = r0;
    }

    return (BigInt(amountIn) * BigInt(reserveOut)) / BigInt(reserveIn);
}

async function buyFixer(wallet, amountFixer) {
    const pair = new ethers.Contract(AERO_PAIR, PAIR_ABI, wallet);

    const t0 = await pair.token0();
    const t1 = await pair.token1();

    let amount0Out = 0n;
    let amount1Out = 0n;

    if (t0.toLowerCase() === FIXER.toLowerCase()) {
        amount0Out = BigInt(amountFixer);
    } else {
        amount1Out = BigInt(amountFixer);
    }

    const tx = await pair.swap(
        amount0Out,
        amount1Out,
        wallet.address,
        "0x",
        { gasLimit: GAS_LIMIT }
    );
    async function sellFixer(wallet, amountFixer) {
    const pair = new ethers.Contract(AERO_PAIR, PAIR_ABI, wallet);

    const amountOutUSDC = await getAmountsOutFromPair(pair, amountFixer, FIXER, USDC);

    const t0 = await pair.token0();
    const t1 = await pair.token1();

    let amount0Out = 0n;
    let amount1Out = 0n;

    if (t0.toLowerCase() === USDC.toLowerCase()) {
        amount0Out = BigInt(amountOutUSDC);
    } else {
        amount1Out = BigInt(amountOutUSDC);
    }

    const tx = await pair.swap(
        amount0Out,
        amount1Out,
        wallet.address,
        "0x",
        { gasLimit: GAS_LIMIT }
    );

    await tx.wait();
    console.log(🔴 SELL ${amountFixer} FIXER | ${wallet.address});
}

// MAIN LOOP
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
            amount = w.netFixer;
        } else if (amount > w.netFixer) {
            amount = w.netFixer;
        }
    }

    console.log(
        🚀 TX #${pointer+1} | ${w.name} → ${action} ${amount} FIXER | netFixer(before)=${w.netFixer}
    );

    try {
        if (action === "BUY") {
            await buyFixer(w.wallet, amount);
            w.buys++;
            w.netFixer += amount;
        } else {
            await sellFixer(w.wallet, amount);
            w.sells++;
            w.netFixer -= amount;
            if (w.netFixer < 0) w.netFixer = 0;
        }

        console.log(
               ➜ netFixer(after)=${w.netFixer}, buys=${w.buys}, sells=${w.sells}
        );
    } catch (e) {
        console.log(❌ TX failed for ${w.name}: ${e.message});
    }

    pointer++;

}, 20 * 1000);

console.log("🚀 BOT READY — Aerodrome FIXER/USDC — 48 TX/day — balance-safe — first TX BUY");


    await tx.wait();
    console.log(🟢 BUY ${amountFixer} FIXER | ${wallet.address});
}
