'use strict';

const request = require('request-promise-native');
const inquirer = require('inquirer');
const moment = require('moment');
const chalk = require('chalk');
const jsonexport = require('jsonexport');
const fs = require('fs');
let options;

try {
  options = require('./options.json');
} catch (ex) {
  options = {};
}

let orders = [];
let linkToSymbolDictionary = {};
let stockSplitsDictionary = {};
let symbolDictionary = {};
const symbolArray = [];

function logSymbolSummary(symbol, symbolObject) {
  console.log(chalk.magenta(symbol));
  console.log(chalk.gray('Shares: '+symbolObject.quantity));
  console.log(chalk.gray('Total Cost: '+symbolObject.total_cost));
  console.log(chalk.gray('Average Cost (Adjusted Base Cost): '+symbolObject.average_cost));
  console.log('');
}

function logStockTransactions(ticker) {
  const symbol = symbolDictionary[ticker];
  console.log('');
  console.log(chalk.underline.bold('Transactions')+'\r');
  console.log('');
  let shares = 0;

  for (let i = 0; i < symbol.transactions.length; i++) {
    const currentTransaction = symbol.transactions[i];
    console.log(chalk.magenta(currentTransaction.side.toUpperCase()));
    console.log(chalk.gray('Date: '+moment(currentTransaction.created_at).format('MMMM Do YYYY, h:mm:ss a')));
    console.log(chalk.gray('Shares: '+currentTransaction.quantity));
    console.log(chalk.gray('Price: '+currentTransaction.average_price));
    console.log('');
    if (currentTransaction.side.toUpperCase() === 'BUY') {
      shares = shares + parseFloat(currentTransaction.quantity);
    } else {
      shares = shares - parseFloat(currentTransaction.quantity);
    }
  }

  console.log(chalk.underline.bold('Summary'));
  console.log('');
  logSymbolSummary(ticker, symbol);
  
  console.log(shares);
}

function logSymbolDictionary() {
  console.log('');
  for (let prop in symbolDictionary) {
    const currentSymbol = symbolDictionary[prop];
    logSymbolSummary(prop, currentSymbol);
  }
}

function exportToCSV() {
  jsonexport(orders,function(err, csv){
    if(err) return console.log(err);
    // console.log(csv);
    
    const wstream = fs.createWriteStream('transactions.csv');
    wstream.write(csv);
    wstream.end();
  });
}

function updateSymbolData(transaction) {
  if (transaction.side === 'buy') {
    
    const symbol = symbolDictionary[transaction.symbol];
    
    const transaction_quantity = parseFloat(transaction.quantity);
    const transaction_price = parseFloat(transaction.average_price);
    
    const new_quantity = symbol.quantity + transaction_quantity;
    const new_total_cost = symbol.total_cost + (transaction_price*transaction_quantity);
    
    symbol.total_cost = new_total_cost;
    symbol.quantity = new_quantity;
    symbol.average_cost = new_total_cost / new_quantity;
    symbol.last_created_at = transaction.created_at;
    symbol.transactions.push(transaction);
  }
  // sell
  else {
    //http://www.onlineconversion.com/adjusted_cost_base.htm
    
    const symbol = symbolDictionary[transaction.symbol];
    
    const transaction_quantity = parseFloat(transaction.quantity);
    const transaction_price = parseFloat(transaction.average_price);

    const new_quantity = symbol.quantity - transaction_quantity;
    const new_total_cost = symbol.total_cost * (new_quantity/symbol.quantity);
    
    symbol.total_cost = new_total_cost;
    symbol.quantity = new_quantity;
    symbol.average_cost = new_total_cost / new_quantity;
    symbol.last_created_at = transaction.created_at;
    symbol.transactions.push(transaction);
  }
}

function skipSplitsForThisSymbol(symbol) {
  if (options.ignoreSplits) {
    for(let i = 0; i < options.ignoreSplits.length; i++) {
      if(options.ignoreSplits[i] === symbol) {
        return true;
      }
    }
    return false;
  }
  return false;
}

function updateSymbolDataWithSplitsLastRun() {
  for (let prop in stockSplitsDictionary) {
    const splits = stockSplitsDictionary[prop];
    const symbol = symbolDictionary[prop];

    if(!skipSplitsForThisSymbol(prop)) {
      for (let i = splits.length-1; i > -1; i--) {
        const currentSplit = splits[i];
    
        // if split is after my last trade
        if (moment(currentSplit.execution_date).isAfter(symbol.last_created_at)) {
          //do math to symbol dictionary to adjust symbol data
          symbol.quantity = symbol.quantity * (parseFloat(currentSplit.multiplier)/parseFloat(currentSplit.divisor));
          symbol.average_cost = symbol.total_cost / symbol.quantity;
          symbol.last_created_at = currentSplit.execution_date;
          //remove split from array so we don't calculate it ever again
          splits.splice(i, 1);
        }
      }
    }
  }
}

function updateSymbolDataWithSplits(transaction) {
  const splits = stockSplitsDictionary[transaction.symbol];
  const symbol = symbolDictionary[transaction.symbol];

  if(!skipSplitsForThisSymbol(transaction.symbol)) {
    for (let i = splits.length-1; i > -1; i--) {
      const currentSplit = splits[i];

      // if split is between my last trade and my new trade
      if (moment(currentSplit.execution_date).isAfter(symbol.last_created_at)
      && moment(currentSplit.execution_date).isBefore(transaction.created_at)) {
        //do math to symbol dictionary to adjust symbol data
        symbol.quantity = symbol.quantity * (parseFloat(currentSplit.multiplier)/parseFloat(currentSplit.divisor));
        symbol.average_cost = symbol.total_cost / symbol.quantity;
        symbol.last_created_at = currentSplit.execution_date;
        //remove split from array so we don't calculate it ever again
        splits.splice(i, 1);
      }
    }
  }
}

function addNewSymbol(transaction) {
  if (transaction.side === 'buy') {

    const price = parseFloat(transaction.average_price);
    const quantity = parseFloat(transaction.quantity);

    symbolDictionary[transaction.symbol] = {
      'average_cost': price * quantity,
      'total_cost': price * quantity,
      'quantity': quantity,
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
    },
    {
      name: 'Export Transactions to CSV',
      value: 'export'
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
    else if (answer.mainMenu === 'export') {
      // exportToCSV();
      for (let k = 0; k < orders.length; k++) {
        const currentOrder = orders[k];
        if (currentOrder.quantity === '4'){
          console.log('HERE');
        }
      }
      
      
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