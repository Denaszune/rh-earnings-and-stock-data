'use strict';

const fs = require('fs');
const inquirer = require('inquirer');
const parse = require('csv-parse');

const question = {
  type: 'input',
  name: 'file',
  message: 'Enter full path to csv file:'
};

let transactionDictionary = {};

function addNewTransaction(transaction) {
  if (transaction.state === 'buy') {
    transactionDictionary[transaction.symbol] = {
      'price': parseFloat(transaction.price),
      'quantity': parseFloat(transaction.quantity)
    };
  }
  // why is the first transaction for this symbol a sell?
  else {
    console.log('why is the first transaction for '+transaction.symbol+' a sell?');
    console.log('aborting transaction');
  }
}

function addOrUpdateFilledTransaction(transaction) {
  // symbol has previous transactions
  if (transactionDictionary.hasOwnProperty(transaction.symbol)) {
    
  }
  // new transaction for this symbol
  else {
    addNewTransaction(transaction);
  }
}

function interateFilledTransactions(transactions) {
  for (let i = transactions.length; i > 0; i--) {
    const transaction = transactions[i];
    
    if (transaction.state === 'filled') {
      addOrUpdateFilledTransaction(transaction);
    }
  }
}

inquirer.prompt([question]).then(function (answer) {
  const transactions = [];
  fs.createReadStream(answer.file)
    .pipe(parse({delimiter: ',', columns:true}))
    .on('data', function(csvrow) {
      transactions.push(csvrow);        
    })
    .on('end',function() {
      interateFilledTransactions(transactions);
    });
});