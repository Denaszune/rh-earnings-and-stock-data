# rh-earnings-and-stock-data

A node script to calculate yearly earnings and track stock averages. Trade transaction data obtained from Robinhood API.

This script relies on [robinhood-to-csv](https://github.com/joshfraser/robinhood-to-csv) to produce a csv file acceptable for parsing.

#### Prerequisites:
node.js v6.11.2 or higher

csv file generated from [robinhood-to-csv](https://github.com/joshfraser/robinhood-to-csv) 

#### Install:
Download repository and then navigate to the root of repository folder.

Use the following command to install dependencies:

```bash
npm install
```

#### Run:
```bash
node index.js
```