'use strict';

const fs = require('fs');
const inquirer = require('inquirer');
const parse = require('csv-parse');

let symbolDictionary = {};

function updateSymbolData(transaction) {
  if (transaction.side === 'buy') {
    
    const symbol = symbolDictionary[transaction.symbol];
    
    const transaction_price = parseFloat(transaction.price);
    const transaction_quantity = parseFloat(transaction.quantity);
    
    const new_total_price = symbol.total_price + (transaction_price*transaction_quantity);
    const new_quantity = symbol.quantity + transaction_quantity;
    
    symbol.total_price = new_total_price;
    symbol.quantity = new_quantity;
    symbol.average_price = new_total_price / new_quantity;
  }
  // sell
  else {
    
    const symbol = symbolDictionary[transaction.symbol];
    
    const transaction_price = parseFloat(transaction.price);
    const transaction_quantity = parseFloat(transaction.quantity);
    
    const new_total_price = symbol.total_price - (transaction_price*transaction_quantity);
    const new_quantity = symbol.quantity - transaction_quantity;
    
    symbol.total_price = new_total_price;
    symbol.quantity = new_quantity;
    symbol.average_price = new_total_price / new_quantity;
  }
}

function addNewSymbol(transaction) {
  if (transaction.side === 'buy') {
    symbolDictionary[transaction.symbol] = {
      'average_price': parseFloat(transaction.price),
      'total_price': parseFloat(transaction.price),
      'quantity': parseFloat(transaction.quantity)
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

const question = {
  type: 'input',
  name: 'file',
  message: 'Enter full path to csv file:'
};

inquirer.prompt([question]).then(function (answer) {
  const transactions = [];
  fs.createReadStream(answer.file)
    .pipe(parse({delimiter: ',', columns:true}))
    .on('data', function(csvrow) {
      transactions.push(csvrow);        
    })
    .on('end',function() {
      interateFilledTransactions(transactions);
      console.log('Below is a list of your Symbols:');
      logSymbolDictionary();
    });
});