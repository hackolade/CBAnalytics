'use strict'

const { buildStatement, getName, getTab, indentString } = require('./generalHelper');
const { getColumnsStatement, getColumnStatement, getColumns } = require('./columnHelper');
const keyHelper = require('./keyHelper');

const getCreateStatement = ({
	dbName, tableName, isTemporary, isExternal, columnStatement, primaryKeyStatement, foreignKeyStatement, comment, partitionedByKeys, 
	clusteredKeys, sortedKeys, numBuckets, skewedStatement, rowFormatStatement, storedAsStatement, location, tableProperties, selectStatement
}) => {
	const temporary = isTemporary ? 'TEMPORARY' : '';
	const external = isExternal ? 'EXTERNAL' : '';
	const tempExtStatement = ' ' + [temporary, external].filter(d => d).map(item => item + ' ').join('');

	return buildStatement(`CREATE${tempExtStatement}TABLE IF NOT EXISTS ${dbName}.${tableName} (`)
		(columnStatement, indentString(columnStatement + (primaryKeyStatement ? ',' : '')))
		(primaryKeyStatement, indentString(primaryKeyStatement))
		(foreignKeyStatement, indentString(foreignKeyStatement))
		(true, ')')
		(comment, `COMMENT "${comment}"`)
		(partitionedByKeys, `PARTITIONED BY (${partitionedByKeys})`)
		(clusteredKeys, `CLUSTERED BY (${clusteredKeys})`)
		(sortedKeys, `SORTED BY (${sortedKeys})`)
		(numBuckets, `INTO ${numBuckets} BUCKETS`)
		(skewedStatement, skewedStatement)
		(rowFormatStatement, `ROW FORMAT ${rowFormatStatement}`)
		(storedAsStatement, storedAsStatement)
		(location, `LOCATION "${location}"`)
		(tableProperties, `TBLPROPERTIES ${tableProperties}`)
		(selectStatement, `AS ${selectStatement}`)
		() + ';';
};

const getPrimaryKeyStatement = (keysNames) => {
	if (!Array.isArray(keysNames) || !keysNames.length) {
		return '';
	}

	return `PRIMARY KEY (${keysNames.join(', ')}) DISABLE NOVALIDATE`;
};

const getClusteringKeys = (clusteredKeys) => {
	if (!Array.isArray(clusteredKeys) || !clusteredKeys.length) {
		return '';
	}

	return clusteredKeys.join(', ');
};

const getSortedKeys = (sortedKeys) => {
	if (!Array.isArray(sortedKeys) || !sortedKeys.length) {
		return '';
	}

	return sortedKeys.map(sortedKey => `${sortedKey.name} ${sortedKey.type}`).join(', ');
};

const getPartitionKeyStatement = (keys) => {
	if (!Array.isArray(keys) || !keys.length) {
		return '';
	}

	return keys.map(getColumnStatement).join(',');
};

const getPartitionsKeys = (columns, partitions) => {
	return partitions.map(keyName => {
		return Object.assign({}, columns[keyName] || { type: 'string' }, { name: keyName });
	}).filter(key => key);
};

const removePartitions = (columns, partitions) => {
	return partitions.reduce((columns, keyName) => {
		delete columns[keyName];

		return columns;
	}, Object.assign({}, columns));
};

const getSkewedKeyStatement = (skewedKeys, skewedOn, asDirectories) => {
	if (!Array.isArray(skewedKeys) || !skewedKeys.length) {
		return '';
	}

	return `SKEWED BY (${skewedKeys.join(', ')}) ON ${skewedOn} ${asDirectories ? 'STORED AS DIRECTORIES' : ''}`;
};

const getRowFormat = (tableData) => {
	if (tableData.storedAsTable !== 'textfile') {
		return '';
	}

	if (tableData.rowFormat === 'delimited') {
		return buildStatement(`DELIMITED`)
			(tableData.fieldsTerminatedBy, `FIELDS TERMINATED BY '${tableData.fieldsTerminatedBy}'`)
			(tableData.fieldsescapedBy, `ESCAPED BY '${tableData.fieldsescapedBy}'`)
			(tableData.collectionItemsTerminatedBy, `COLLECTION ITEMS TERMINATED BY '${tableData.collectionItemsTerminatedBy}'`)
			(tableData.mapKeysTerminatedBy, `MAP KEYS TERMINATED BY '${tableData.mapKeysTerminatedBy}'`)
			(tableData.linesTerminatedBy, `LINES TERMINATED BY '${tableData.linesTerminatedBy}'`)
			(tableData.nullDefinedAs, `NULL DEFINED AS '${tableData.nullDefinedAs}'`)
			();
	} else if (tableData.rowFormat === 'SerDe') {
		return buildStatement(`SERDE '${tableData.serDeLibrary}'`)
			(tableData.serDeProperties, `WITH SERDEPROPERTIES ${tableData.serDeProperties}`)
			();
	}
};

const getStoredAsStatement = (tableData) => {
	if (!tableData.storedAsTable) {
		return '';
	}

	if (tableData.storedAsTable === 'input/output format') {
		return `STORED AS INPUTFORMAT '${tableData.inputFormatClassname}' OUTPUTFORMAT '${tableData.outputFormatClassname}'`;
	}

	if (tableData.storedAsTable === 'by') {
		return `STORED BY '${tableData.serDeLibrary}'`;
	}

	return `STORED AS ${tableData.storedAsTable.toUpperCase()}`;
};

const getTableStatement = (containerData, entityData, jsonSchema, definitions, foreignKeyStatement) => {
	const dbName = getName(getTab(0, containerData));
	const tableData = getTab(0, entityData);
	const tableName = getName(tableData);
	const columns = getColumns(jsonSchema);
	const keyNames = keyHelper.getKeyNames(tableData, jsonSchema, definitions);

	const tableStatement = getCreateStatement({
		dbName,
		tableName,
		isTemporary: tableData.temporaryTable,
		isExternal: tableData.externalTable,
		columnStatement: getColumnsStatement(removePartitions(columns, keyNames.compositePartitionKey)),
		primaryKeyStatement: getPrimaryKeyStatement(keyNames.primaryKeys),
		foreignKeyStatement: foreignKeyStatement,
		comment: tableData.comments,
		partitionedByKeys: getPartitionKeyStatement(getPartitionsKeys(columns, keyNames.compositePartitionKey)),
		clusteredKeys: getClusteringKeys(keyNames.compositeClusteringKey),
		sortedKeys: getSortedKeys(keyNames.sortedByKey), 
		numBuckets: tableData.numBuckets,
		skewedStatement: getSkewedKeyStatement(keyNames.skewedby, tableData.skewedOn, tableData.skewStoredAsDir),
		rowFormatStatement: getRowFormat(tableData),
		storedAsStatement: getStoredAsStatement(tableData),
		location: tableData.location,
		tableProperties: tableData.tableProperties,
		selectStatement: ''
	});

	return tableStatement;
};

module.exports = {
	getTableStatement
};
