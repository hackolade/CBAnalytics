'use strict'

const { getDatabaseStatement } = require('./helpers/databaseHelper');
const { getTableStatement } = require('./helpers/tableHelper');
const { getIndexes } = require('./helpers/indexHelper');
const foreignKeyHelper = require('./helpers/foreignKeyHelper');

module.exports = {
	generateScript(data, logger, callback) {
		try {
			const jsonSchema = JSON.parse(data.jsonSchema);
			const modelDefinitions = JSON.parse(data.modelDefinitions);
			const internalDefinitions = JSON.parse(data.internalDefinitions);
			const externalDefinitions = JSON.parse(data.externalDefinitions);
			const containerData = data.containerData;
			const entityData = data.entityData;
			
			callback(null, buildScript(
				getDatabaseStatement(containerData),
				getTableStatement(containerData, entityData, jsonSchema, [
					modelDefinitions,
					internalDefinitions,
					externalDefinitions
				]),
				getIndexes(containerData, entityData, jsonSchema, [
					modelDefinitions,
					internalDefinitions,
					externalDefinitions
				])
			));
		} catch (e) {
			logger.log('error', { message: e.message, stack: e.stack }, 'Hive Forward-Engineering Error');

			setTimeout(() => {
				callback({ message: e.message, stack: e.stack });
			}, 150);
		}
	},

	generateContainerScript(data, logger, callback) {
		try {
			const containerData = data.containerData;
			const modelDefinitions = JSON.parse(data.modelDefinitions);
			const externalDefinitions = JSON.parse(data.externalDefinitions);
			const databaseStatement = getDatabaseStatement(containerData);
			const jsonSchema = parseEntities(data.entities, data.jsonSchema);
			const internalDefinitions = parseEntities(data.entities, data.internalDefinitions);
			const foreignKeyHashTable = foreignKeyHelper.getForeignKeyHashTable(
				data.relationships,
				data.entities,
				data.entityData,
				jsonSchema,
				internalDefinitions,
				[
					modelDefinitions,
					externalDefinitions
				]
			);

			const entities = data.entities.reduce((result, entityId) => {
				const args = [
					containerData,
					data.entityData[entityId],
					jsonSchema[entityId], [
						internalDefinitions[entityId],
						modelDefinitions,
						externalDefinitions
					]
				];

				return result.concat([
					getTableStatement(...args),
					getIndexes(...args),
				]);
			}, []);

			const foreignKeys = data.entities.reduce((result, entityId) => {
				const foreignKeyStatement = foreignKeyHelper.getForeignKeyStatementsByHashItem(foreignKeyHashTable[entityId] || {});
			
				if (foreignKeyStatement) {
					return [...result, foreignKeyStatement];
				}

				return result;
			}, []).join('\n');

			callback(null, buildScript(
				databaseStatement,
				...entities,
				foreignKeys
			));
		} catch (e) {
			logger.log('error', { message: e.message, stack: e.stack }, 'Cassandra Forward-Engineering Error');

			setTimeout(() => {
				callback({ message: e.message, stack: e.stack });
			}, 150);
		}
	}
};

const buildScript = (...statements) => {
	return statements.filter(statement => statement).join('\n\n');
};

const parseEntities = (entities, serializedItems) => {
	return entities.reduce((result, entityId) => {
		try {
			return Object.assign({}, result, { [entityId]: JSON.parse(serializedItems[entityId]) });
		} catch (e) {
			return result;
		}
	}, {});
};
