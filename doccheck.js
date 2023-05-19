#!/usr/bin/env node

import {program} from 'commander';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import got from 'got'; 

import { stringify } from 'csv-stringify';

const GOTD = 'https://go.treasuredata.com';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorized: true
    }
  }
});

program
  .requiredOption('-p, --path <yaml dir>')
  .option('-i, --info', 'Doc paths and doc links report')
  .option('-c, --by-category', 'Report by catalog and categories')
  .requiredOption('-e, --export <csv name>', 'Export to csv file');

program.parse();

const options = program.opts();

const allYaml = fs.readdirSync(options.path);

if (!allYaml || !allYaml.length) {
  logger.error('Could not find yaml files');
}

const docInfo = new Map();
const byCatalogAndCategory = new Map();

logger.info('Parsing yaml files...');

allYaml.forEach((ymlFile) => {
  try {
    const filePath = path.resolve(options.path, ymlFile);
    const ymlDoc = yaml.load(fs.readFileSync(filePath, 'utf8'));

    let docPaths = [];

    docPaths.push(ymlDoc.docs_path);

    const documentationLinks = ymlDoc.documentation_links || {};

    if (documentationLinks.import && !docPaths.includes(documentationLinks.import)) {
      docPaths.push(documentationLinks.import);
    }

    if (documentationLinks.export && !docPaths.includes(documentationLinks.export)) {
      docPaths.push(documentationLinks.export);
    }

    docInfo.set(path.basename(filePath), docPaths);

    byCatalogAndCategory.set(ymlDoc.name, ymlDoc.categories);
  } catch (e) {
    logger.error(e);
  }
});

let csvFileName;
let csvFilePath;
let writableStream;

if (options.byCategory) {
  csvFileName = options.export + '.csv';
  csvFilePath = path.resolve('./' + csvFileName);
  writableStream = fs.createWriteStream(csvFilePath);
  const columns = [
    "Catalog",
    "Categories"
  ];
  const stringifier = stringify({ header: true, columns: columns });
  stringifier.pipe(writableStream);

  for (const [key, categories] of byCatalogAndCategory) {
    try {
      const data = [key, categories.join('\n')];
      stringifier.write(data);
    } catch( e ) {
      logger.error(e.message);
    }
  }

} else if (options.info){
  csvFileName = options.export + '.csv';
  csvFilePath = path.resolve('./' + csvFileName);
  writableStream = fs.createWriteStream(csvFilePath);

  const columns = [
    "Catalog",
    "Doc path",
    "Redirect",
    "Wrong/Default"
  ];

  const stringifier = stringify({ header: true, columns: columns });
  stringifier.pipe(writableStream);

  for (const [key, value] of docInfo) {
    value.forEach( async (url) => {
      try {
        const response = await got.get(GOTD + url, { followRedirect: false });
        const location = response.headers.location;

        const data = [
          key,
          url,
          location
        ];

        if (/^(http|https):\/\/www\.treasuredata/i.test(location)) {
          data.push('yes');
        } else if (/^(http|https):\/\/docs\.treasuredata/i.test(location)) {
          data.push('no');
        }

        stringifier.write(data);
      } catch (e) {
        const errorInfo = [
          key, url, '', e.message
        ];
        stringifier.write(errorInfo);
      }
    });
  }
}

