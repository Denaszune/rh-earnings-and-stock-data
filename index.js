'use strict';

const request = require('request-promise-native');
const inquirer = require('inquirer');

let symbolDictionary = {};

function logSymbolDictionary() {
  for (let prop in symbolDictionary) {
    const currentSymbol = symbolDictionary[prop];
    console.log('---------');
    console.log(prop);
    console.log('Total Cost: '+currentSymbol.total_price);
    console.log('Average Cost: '+currentSymbol.average_price);
    console.log('Quantity: '+currentSymbol.quantity);
  }
}

function updateSymbolData(transaction) {
  if (transaction.side === 'buy') {
    
    const symbol = symbolDictionary[transaction.instrument];
    
    const transaction_quantity = parseFloat(transaction.quantity);
    const transaction_price = parseFloat(transaction.price);
    
    const new_quantity = symbol.quantity + transaction_quantity;
    const new_total_price = symbol.total_price + (transaction_price*transaction_quantity);
    
    symbol.total_price = new_total_price;
    symbol.quantity = new_quantity;
    symbol.average_price = new_total_price / new_quantity;
  }
  // sell
  else {
    //http://www.onlineconversion.com/adjusted_cost_base.htm
    
    const symbol = symbolDictionary[transaction.instrument];
    
    const transaction_quantity = parseFloat(transaction.quantity);
    const transaction_price = parseFloat(transaction.price);

    const new_quantity = symbol.quantity - transaction_quantity;
    const new_total_price = symbol.total_price * (new_quantity/symbol.quantity);
    
    symbol.total_price = new_total_price;
    symbol.quantity = new_quantity;
    symbol.average_price = new_total_price / new_quantity;
  }
}

function addNewSymbol(transaction) {
  if (transaction.side === 'buy') {
    symbolDictionary[transaction.instrument] = {
      'average_price': parseFloat(transaction.price),
      'total_price': parseFloat(transaction.price),
      'quantity': parseFloat(transaction.quantity)
    };
  }
  // why is the first transaction for this symbol a sell? Free stock...
  else {
    console.log('Why is the first transaction for '+transaction.instrument +' a sell? Aborting transaction...');
  }
}

function addOrUpdateFilledTransaction(transaction) {
  // symbol has previous transactions
  if (symbolDictionary.hasOwnProperty(transaction.instrument)) {
    updateSymbolData(transaction);
  }
  // new transaction for this symbol
  else {
    addNewSymbol(transaction);
  }
}

function interateFilledTransactions(transactions) {
  for (let i = transactions.length-1; i > -1; i--) {
    const transaction = transactions[i];
    
    if (transaction.state === 'filled') {
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
  let orders = [];
  let trades = await getTrades(token, 'https://api.robinhood.com/orders/');
  orders = orders.concat(trades.results);

  while(trades.next) {
    trades = await getTrades(token, trades.next);
    orders = orders.concat(trades.results);
  }
  interateFilledTransactions(orders);
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