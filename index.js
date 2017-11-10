'use strict';

const request = require('request-promise-native');
const inquirer = require('inquirer');
const moment = require('moment');

let linkToSymbolDictionary = {};
let stockSplitsDictionary = {};
let symbolDictionary = {};

function logSymbolDictionary() {
  for (let prop in symbolDictionary) {
    const currentSymbol = symbolDictionary[prop];
    console.log('---------');
    console.log(prop);
    console.log('Shares: '+currentSymbol.quantity);
    console.log('Total Cost: '+currentSymbol.total_price);
    console.log('Average Cost (Adjusted Base Cost): '+currentSymbol.average_price);
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
      'last_created_at': transaction.created_at
    };
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
  console.log('Querying database...');
  let orders = [];
  let trades = await getTrades(token, 'https://api.robinhood.com/orders/');
  orders = orders.concat(trades.results);

  while(trades.next) {
    trades = await getTrades(token, trades.next);
    orders = orders.concat(trades.results);
  }
  await interateFilledTransactions(orders);
  updateSymbolDataWithSplitsLastRun();
  logSymbolDictionary();
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
      process(mfaResponse.token);
    });
  } 
  // No Multi-factor authentication
  else {
    process(credentialsResponse.token);
  }
});