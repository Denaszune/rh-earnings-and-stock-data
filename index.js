'use strict';

const request = require('request-promise-native');
const inquirer = require('inquirer');
const moment = require('moment');
const chalk = require('chalk');

let linkToSymbolDictionary = {};
let stockSplitsDictionary = {};
let symbolDictionary = {};
const symbolArray = [];

function logSymbolSummary(symbol, symbolObject) {
  console.log(chalk.magenta(symbol));
  console.log(chalk.gray('Shares: '+symbolObject.quantity));
  console.log(chalk.gray('Total Cost: '+symbolObject.total_price));
  console.log(chalk.gray('Average Cost (Adjusted Base Cost): '+symbolObject.average_price));
  console.log('');
}

function logStockTransactions(ticker) {
  const symbol = symbolDictionary[ticker];
  console.log('');
  console.log(chalk.underline.bold('Transactions')+'\r');
  console.log('');

  for (let i = 0; i < symbol.transactions.length; i++) {
    const currentTransaction = symbol.transactions[i];
    console.log(chalk.magenta(currentTransaction.side.toUpperCase()));
    console.log(chalk.gray('Date: '+moment(currentTransaction.created_at).format('MMMM Do YYYY, h:mm:ss a')));
    console.log(chalk.gray('Shares: '+currentTransaction.quantity));
    console.log(chalk.gray('Price: '+currentTransaction.price));
    console.log('');
  }

  console.log(chalk.underline.bold('Summary'));
  console.log('');
  logSymbolSummary(ticker, symbol);
}

function logSymbolDictionary() {
  console.log('');
  for (let prop in symbolDictionary) {
    const currentSymbol = symbolDictionary[prop];
    logSymbolSummary(prop, currentSymbol);
  }
}

function updateSymbolData(transaction) {
  if (transaction.side === 'buy') {
    
    const symbol = symbolDictionary[transaction.symbol];
    
    const transaction_quantity = parseFloat(transaction.quantity);
    const transaction_price = parseFloat(transaction.price);
    
    const new_quantity = symbol.quantity + transaction_quantity;
    const new_total_price = symbol.total_price + (transaction_price*transaction_quantity);
    
    symbol.total_price = new_total_price;
    symbol.quantity = new_quantity;
    symbol.average_price = new_total_price / new_quantity;
    symbol.last_created_at = transaction.created_at;
    symbol.transactions.push(transaction);
  }
  // sell
  else {
    //http://www.onlineconversion.com/adjusted_cost_base.htm
    
    const symbol = symbolDictionary[transaction.symbol];
    
    const transaction_quantity = parseFloat(transaction.quantity);
    const transaction_price = parseFloat(transaction.price);

    const new_quantity = symbol.quantity - transaction_quantity;
    const new_total_price = symbol.total_price * (new_quantity/symbol.quantity);
    
    symbol.total_price = new_total_price;
    symbol.quantity = new_quantity;
    symbol.average_price = new_total_price / new_quantity;
    symbol.last_created_at = transaction.created_at;
    symbol.transactions.push(transaction);
  }
}

function updateSymbolDataWithSplitsLastRun() {
  for (let prop in stockSplitsDictionary) {
    const splits = stockSplitsDictionary[prop];
    const symbol = symbolDictionary[prop];
    
    for (let i = splits.length-1; i > -1; i--) {
      const currentSplit = splits[i];
  
      // if split is after my last trade
      if (moment(currentSplit.execution_date).isAfter(symbol.last_created_at)) {
        //do math to symbol dictionary to adjust symbol data
        symbol.quantity = symbol.quantity * (parseFloat(currentSplit.multiplier)/parseFloat(currentSplit.divisor));
        symbol.average_price = symbol.total_price / symbol.quantity;
        symbol.last_created_at = currentSplit.execution_date;
        //remove split from array so we don't calculate it ever again
        splits.splice(i, 1);
      }
    }
  }
}

function updateSymbolDataWithSplits(transaction) {
  const splits = stockSplitsDictionary[transaction.symbol];
  const symbol = symbolDictionary[transaction.symbol];

  for (let i = splits.length-1; i > -1; i--) {
    const currentSplit = splits[i];

    // if split is between my last trade and my new trade
    if (moment(currentSplit.execution_date).isAfter(symbol.last_created_at)
    && moment(currentSplit.execution_date).isBefore(transaction.created_at)) {
      //do math to symbol dictionary to adjust symbol data
      symbol.quantity = symbol.quantity * (parseFloat(currentSplit.multiplier)/parseFloat(currentSplit.divisor));
      symbol.average_price = symbol.total_price / symbol.quantity;
      symbol.last_created_at = currentSplit.execution_date;
      //remove split from array so we don't calculate it ever again
      splits.splice(i, 1);
    }
  }
}

function addNewSymbol(transaction) {
  if (transaction.side === 'buy') {
    symbolDictionary[transaction.symbol] = {
      'average_price': parseFloat(transaction.price),
      'total_price': parseFloat(transaction.price),
      'quantity': parseFloat(transaction.quantity),
      'last_created_at': transaction.created_at,
      'transactions': [transaction]
    };
    symbolArray.push(transaction.symbol);
  }
  // why is the first transaction for this symbol a sell? Free stock...
  else {
    console.log('Why is the first transaction for '+transaction.symbol +' a sell? Aborting transaction...');
  }
}

function addOrUpdateFilledTransaction(transaction) {
  // symbol has previous transactions
  if (symbolDictionary.hasOwnProperty(transaction.symbol)) {
    updateSymbolDataWithSplits(transaction);
    updateSymbolData(transaction);
  }
  // new transaction for this symbol
  else {
    addNewSymbol(transaction);
  }
}

async function getInstrumentOrSplits(uri) {
  const options = {
    method: 'GET',
    uri: uri,
    json: true
  };
  try {
    const response = await request(options);
    return Promise.resolve(response);
  }
  catch (error) {
    return Promise.reject(error);
  }
}

async function getSymbol(transaction) {
  if (linkToSymbolDictionary.hasOwnProperty(transaction.instrument)) {
    return linkToSymbolDictionary[transaction.instrument];
  }
  else {
    const instrument = await getInstrumentOrSplits(transaction.instrument);
    const splits = await getInstrumentOrSplits(instrument.splits);
    linkToSymbolDictionary[transaction.instrument] = instrument.symbol;
    stockSplitsDictionary[instrument.symbol] = splits.results;
    return instrument.symbol;
  }
}

async function interateFilledTransactions(transactions) {
  for (let i = transactions.length-1; i > -1; i--) {
    const transaction = transactions[i];
    if (transaction.state === 'filled') {
      transaction['symbol'] = await getSymbol(transaction);
      addOrUpdateFilledTransaction(transaction);
    }
  }
}

async function getTrades(token, uri) {
  const options = {
    method: 'GET',
    uri: uri,
    headers: {
      'Authorization': 'Token ' + token
    },
    json: true
  };
  try {
    const response = await request(options);
    return Promise.resolve(response);
  }
  catch (error) {
    return Promise.reject(error);
  }
}

async function process(token) {
  console.log(chalk.gray('Querying database and doing math...'));
  let orders = [];
  let trades = await getTrades(token, 'https://api.robinhood.com/orders/');
  orders = orders.concat(trades.results);

  while(trades.next) {
    trades = await getTrades(token, trades.next);
    orders = orders.concat(trades.results);
  }
  await interateFilledTransactions(orders);
  updateSymbolDataWithSplitsLastRun();
}

const mainMenuQuestion = [{
  type: 'list',
  name: 'mainMenu',
  message: 'Main Menu',
  choices: [
    {
      name: 'Individual Stock Summary',
      value: 'transactions'
    },
    {
      name: 'Portfolio Summary',
      value: 'stocks'
    },
    {
      name: 'Yearly Earnings',
      value: 'earnings'
    }
  ]
}];

function showMainMenu() {
  inquirer.prompt(mainMenuQuestion).then(answer => {
    if (answer.mainMenu === 'transactions') {
      const tickerQuestion = [{
        type: 'list',
        name: 'ticker',
        message: 'Choose a symbol:',
        choices: symbolArray
      }];

      inquirer.prompt(tickerQuestion).then(answer => {
        logStockTransactions(answer.ticker);
        showMainMenu();
      });
    } 
    else if (answer.mainMenu === 'stocks') {
      logSymbolDictionary();
      showMainMenu();
    }
    else if (answer.mainMenu === 'earnings') {
      showMainMenu();
    }
  });
}

async function login(credentials) {
  const options = {
    method: 'POST',
    uri: 'https://api.robinhood.com/api-token-auth/',
    body: credentials,
    json: true
  };
  try {
    const response = await request(options);
    return Promise.resolve(response);
  }
  catch (error) {
    return Promise.reject(error);
  }
}

const credentialsQuestions = [{
  type: 'input',
  name: 'username',
  message: 'Enter Robinhood Username:'
  },
  {
  type: 'password',
  name: 'password',
  message: 'Enter Robinhood Password:'
}];

inquirer.prompt(credentialsQuestions).then(async credentials => {
  const credentialsResponse = await login(credentials);
  
  // Multi-factor authentication required
  if (credentialsResponse.mfa_required === true) {
    const mfaQuestion = {
      type:'input', 
      name:'mfa_code', 
      message:'Enter Robinhood MFA code:'
    };
    
    inquirer.prompt([mfaQuestion]).then(async mfa => {
      credentials["mfa_code"] = mfa.mfa_code;
      const mfaResponse = await login(credentials);
      await process(mfaResponse.token);
      showMainMenu();
    });
  } 
  // No Multi-factor authentication
  else {
    process(credentialsResponse.token);
  }
});