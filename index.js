'use strict';

const fs = require('fs');
const inquirer = require('inquirer');
const parse = require('csv-parse');

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
      console.log(transactions);
    });
});