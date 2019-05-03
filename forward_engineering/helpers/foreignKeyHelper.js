'use strict'

const schemaHelper = require('./jsonSchemaHelper');
const { getName, getTab } = require('./generalHelper');

const getIdToNameHashTable = (relationships, entities, jsonSchemas, internalDefinitions, otherDefinitions) => {
	const entitiesForHashing = entities.filter(entityId => relationships.find(relationship => (
		relationship.childCollection === entityId || relationship.parentCollection === entityId
	)));

	return entitiesForHashing.reduce((hashTable, entityId) => {
		return Object.assign(
			{},
			hashTable,
			schemaHelper.getIdToNameHashTable([
				jsonSchemas[entityId],
				internalDefinitions[entityId],
				...otherDefinitions	
			])
		);
	}, {});
};

const getForeignKeyHashTable = (relationships, entities, entityData, jsonSchemas, internalDefinitions, otherDefinitions) => {
	const idToNameHashTable = getIdToNameHashTable(relationships, entities, jsonSchemas, internalDefinitions, otherDefinitions);

	return relationships.reduce((hashTable, relationship) => {
		if (!hashTable[relationship.childCollection]) {
			hashTable[relationship.childCollection] = {};
		}

		const constraintName = relationship.name;
		const parentTableName = getName(getTab(0, entityData[relationship.parentCollection]));
		const childTableName = getName(getTab(0, entityData[relationship.childCollection]));
		const groupKey = parentTableName + constraintName;

		if (!hashTable[relationship.childCollection][groupKey]) {
			hashTable[relationship.childCollection][groupKey] = [];
		}
		const disableNoValidate = ((relationship || {}).customProperties || {}).disableNoValidate;
		
		hashTable[relationship.childCollection][groupKey].push({
			name: relationship.name,
			disableNoValidate: disableNoValidate,
			parentTableName: parentTableName,
			childTableName: childTableName,
			parentColumn: schemaHelper.getNameByPath(idToNameHashTable, (relationship.parentField || []).slice(1)),
			childColumn: schemaHelper.getNameByPath(idToNameHashTable, (relationship.childField || []).slice(1))
		});
		
		return hashTable;
	}, {});
};

const getForeignKeyStatementsByHashItem = (hashItem) => {
	return Object.keys(hashItem || {}).map(groupKey => {
		const keys = hashItem[groupKey];
		const constraintName = (keys[0] || {}).name;
		const parentTableName = (keys[0] || {}).parentTableName;
		const childTableName = (keys[0] || {}).childTableName;
		const disableNoValidate = keys.some(item => (item || {}).disableNoValidate);
		const childColumns = keys.map(item => item.childColumn).join(', ');
		const parentColumns = keys.map(item => item.parentColumn).join(', ');

		return `ALTER TABLE ${childTableName} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${childColumns}) REFERENCES ${parentTableName}(${parentColumns}) ${disableNoValidate ? 'DISABLE NOVALIDATE' : ''};`;
	}).join('\n');
};

module.exports = {
	getForeignKeyHashTable,
	getForeignKeyStatementsByHashItem
};
