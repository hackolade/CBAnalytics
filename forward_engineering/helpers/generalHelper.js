'use strict'

const buildStatement = (mainStatement) => {
	let composeStatements = (...statements) => {
		return statements.reduce((result, statement) => result + statement, mainStatement);
	};

	const chain = (...args) => {
		if (args.length) {
			composeStatements = composeStatements.bind(null, getStatement(...args));

			return chain;
		}

		return composeStatements();
	};

	const getStatement = (condition, statement) => {
		if (condition) {
			return '\n' + indentString(statement);
		}

		return '';
	};

	return chain;
};

const getName = (entity) => entity.code || entity.collectionName || entity.name || '';
const getTab = (tabNum, configData) => Array.isArray(configData) ? (configData[tabNum] || {}) : {};
const indentString = (str, tab = 4) => (str || '').split('\n').map(s => ' '.repeat(tab) + s).join('\n');

const descriptors = {};
const getTypeDescriptor = (typeName) => {
	if (descriptors[typeName]) {
		return descriptors[typeName];
	}

	try {
		descriptors[typeName] = require(`../../types/${typeName}.json`);
		
		return descriptors[typeName];
	} catch (e) {
		return {};
	}
};

module.exports = {
	buildStatement,
	getName,
	getTab,
	indentString,
	getTypeDescriptor
};
