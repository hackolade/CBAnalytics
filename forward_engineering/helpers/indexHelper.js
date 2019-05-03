'use strict'

const { getTab, buildStatement, getName } = require('./generalHelper');
const schemaHelper = require('./jsonSchemaHelper');

const getIndexStatement = ({
	name, tableName, dbName, columns, indexHandler, comment, withDeferredRebuild,
	idxProperties, inTable
}) => {
	return buildStatement(`CREATE INDEX ${name} ON TABLE ${dbName}.${tableName} (${columns}) AS '${indexHandler}'`)
		(withDeferredRebuild, 'WITH DEFERRED REBUILD')
		(idxProperties, `IDXPROPERTIES ${idxProperties}`)
		(inTable, inTable)
		(comment, `COMMENT '${comment}'`)
		() + ';';
};

const getIndexKeys = (keys, jsonSchema, definitions) => {
	if (!Array.isArray(keys)) {
		return '';
	}

	const paths = schemaHelper.getPathsByIds(keys.map(key => key.keyId), [jsonSchema, ...definitions]);
	const idToNameHashTable = schemaHelper.getIdToNameHashTable([jsonSchema, ...definitions]);

	return paths
		.map(path => schemaHelper.getNameByPath(idToNameHashTable, path))
		.join(', ');
};

const getIndexes = (containerData, entityData, jsonSchema, definitions) => {
	const dbName = getName(getTab(0, containerData));
	const tableData = getTab(0, entityData);
	const indexesData = getTab(1, entityData).SecIndxs || [];
	const tableName = getName(tableData);

	return indexesData.map(indexData => getIndexStatement({
		name: indexData.name,
		dbName: dbName,
		tableName: tableName,
		columns: getIndexKeys(indexData.SecIndxKey, jsonSchema, definitions),
		indexHandler: indexData.SecIndxHandler,
		inTable: indexData.SecIndxTable,
		comment: indexData.SecIndxComments,
		withDeferredRebuild: indexData.SecIndxWithDeferredRebuild
	})).join('\n\n');
};

module.exports = {
	getIndexes
};
