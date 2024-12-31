const fs = require("fs");
const chalk = require("chalk");
const ora = require("ora-classic");
const bs58 = require("bs58");
const { Jupiter } = require("@jup-ag/core");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");

const { logExit } = require("./exit");
const { loadConfigFile, toDecimal } = require("../utils");
const { intro, listenHotkeys } = require("./ui");
const cache = require("./cache");
const wrapUnwrapSOL = cache.wrapUnwrapSOL;

const balanceCheck = async (checkToken) => {
    let checkBalance = BigInt(0);
    const connection = new Connection(process.env.DEFAULT_RPC);
    const wallet = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_WALLET_PRIVATE_KEY));
    console.log("Checking wallet balance for:", checkToken.symbol);

    try {
        if (wrapUnwrapSOL && checkToken.address === 'So11111111111111111111111111111111111111112') {
            const balance = await connection.getBalance(wallet.publicKey);
            checkBalance = BigInt(balance);
        } else {
            const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
                mint: new PublicKey(checkToken.address),
            });

            checkBalance = tokenAccounts.value.reduce((sum, account) => {
                return sum + BigInt(account.account.data.parsed.info.tokenAmount.amount);
            }, BigInt(0));
        }

        console.log(`Wallet balance for ${checkToken.symbol}: ${toDecimal(checkBalance, checkToken.decimals)}`);
        return checkBalance;
    } catch (error) {
        console.error(`Error fetching balance for ${checkToken.symbol}:`, error.message);
        return BigInt(0);
    }
};

const checkTokenABalance = async (tokenA, initialTradingBalance) => {
    try {
        const balance = await balanceCheck(tokenA);
        if (balance < BigInt(initialTradingBalance)) {
            throw new Error(`Insufficient balance of ${tokenA.symbol}. You have ${toDecimal(balance, tokenA.decimals)}, but need ${toDecimal(BigInt(initialTradingBalance), tokenA.decimals)}.`);
        }
        return balance;
    } catch (error) {
        console.error(error.message);
        process.exit(1);
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
        if (!tokenA) {
            throw new Error(`Token A (${cache.config.tokenA.address}) not found in tokens.json.`);
        }

        if (cache.config.tradingStrategy !== "arbitrage") {
            tokenB = tokens.find((t) => t.address === cache.config.tokenB.address);
            if (!tokenB) {
                throw new Error(`Token B (${cache.config.tokenB.address}) not found in tokens.json.`);
            }
        }

        spinner.succeed("Tokens loaded.");

        spinner.text = "Checking wallet...";
        wallet = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_WALLET_PRIVATE_KEY));
        spinner.succeed("Wallet verified.");

        const connection = new Connection(cache.config.rpc[0], "confirmed");

        spinner.text = "Initializing Jupiter...";
        const jupiter = await Jupiter.load({
            connection,
            cluster: cache.config.network,
            user: wallet,
            restrictIntermediateTokens: false,
            shouldLoadSerumOpenOrders: false,
            wrapUnwrapSOL: cache.wrapUnwrapSOL,
        });

        cache.isSetupDone = true;
        spinner.succeed("Setup complete. Ready to trade!");
        return { jupiter, tokenA, tokenB, wallet };
    } catch (error) {
        if (spinner) spinner.fail(`Setup failed: ${error.message}`);
        logExit(1, error);
        process.exit(1);
    }
};

const getInitialotherAmountThreshold = async (jupiter, inputToken, outputToken, amountToTrade) => {
    let spinner;
    try {
        console.log("Debugging Route Computation:");
        console.log(`Input Token: ${inputToken.symbol}, Address: ${inputToken.address}`);
        console.log(`Output Token: ${outputToken.symbol}, Address: ${outputToken.address}`);
        console.log(`Amount to Trade: ${amountToTrade}`);

        spinner = ora("Computing routes...").start();
        const routes = await jupiter.computeRoutes({
            inputMint: new PublicKey(inputToken.address),
            outputMint: new PublicKey(outputToken.address),
            amount: amountToTrade.toString(),
            slippageBps: 50,
        });

        if (routes?.routesInfos?.length > 0) {
            spinner.succeed("Routes computed successfully.");
            console.log("Computed Route Details:", routes.routesInfos[0]);
            return routes.routesInfos[0]?.otherAmountThreshold;
        } else {
            spinner.fail("No routes found for the input and output mints.");
            console.error(`Routes:`, routes); // Log the complete response for debugging
        }
    } catch (error) {
        if (spinner) spinner.fail(`Failed to compute routes: ${error.message}`);
        console.error("Error Details:", error); // Log detailed error information
        logExit(1, error);
        process.exit(1);
    }
};

module.exports = {
    setup,
    getInitialotherAmountThreshold,
    balanceCheck,
    checkTokenABalance,
};

