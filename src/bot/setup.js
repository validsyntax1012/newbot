const fs = require("fs");
const ora = require("ora-classic");
const bs58 = require("bs58");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { createJupiterApiClient } = require("@jup-ag/api"); // Import the function to create the API client

const { logExit } = require("./exit");
const { loadConfigFile, toDecimal } = require("../utils");
const { intro, listenHotkeys } = require("./ui");
const cache = require("./cache");

const balanceCheck = async (checkToken) => {
    let checkBalance = BigInt(0);
    const connection = new Connection(process.env.DEFAULT_RPC);
    const wallet = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_WALLET_PRIVATE_KEY));
    console.log("Checking wallet balance for:", checkToken.symbol);

    try {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
            mint: new PublicKey(checkToken.address),
        });

        checkBalance = tokenAccounts.value.reduce((sum, account) => {
            return sum + BigInt(account.account.data.parsed.info.tokenAmount.amount);
        }, BigInt(0));

        console.log(`Wallet balance for ${checkToken.symbol}: ${toDecimal(checkBalance, checkToken.decimals)}`);
        return checkBalance;
    } catch (error) {
        console.error(`Error fetching balance for ${checkToken.symbol}:`, error.message);
        return BigInt(0);
    }
};

const setup = async () => {
    let spinner, tokens, tokenA, tokenB, wallet;

    try {
        listenHotkeys();
        await intro();

        cache.config = loadConfigFile({ showSpinner: false });

        spinner = ora("Loading tokens...").start();

        tokens = JSON.parse(fs.readFileSync("./temp/tokens.json"));
        tokenA = tokens.find((t) => t.address === cache.config.tokenA.address);
        tokenB = tokens.find((t) => t.address === cache.config.tokenB.address);

        if (!tokenA || !tokenB) {
            throw new Error("Token configuration is incomplete in tokens.json.");
        }

        spinner.succeed("Tokens loaded.");

        spinner.text = "Checking wallet...";
        wallet = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_WALLET_PRIVATE_KEY));
        spinner.succeed("Wallet verified.");

        const connection = new Connection(cache.config.rpc[0], "confirmed");

        spinner.text = "Initializing Jupiter API...";
        const jupiterApiClient = createJupiterApiClient(); // Initialize the API client

        spinner.succeed("Jupiter API initialized.");

        return { jupiterApiClient, tokenA, tokenB, wallet, connection };
    } catch (error) {
        if (spinner) spinner.fail(`Setup failed: ${error.message}`);
        logExit(1, error);
        process.exit(1);
    }
};

module.exports = {
    setup,
    balanceCheck,
};

