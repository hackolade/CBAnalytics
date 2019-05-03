'use strict';

const _ = require('lodash');
const async = require('async');
const thriftService = require('./thriftService/thriftService');
const hiveHelper = require('./thriftService/hiveHelper');
const entityLevelHelper = require('./entityLevelHelper');
const TCLIService = require('./TCLIService/Thrift_0.9.3_Hive_2.1.1/TCLIService');
const TCLIServiceTypes = require('./TCLIService/Thrift_0.9.3_Hive_2.1.1/TCLIService_types');

module.exports = {
	connect: function(connectionInfo, logger, cb){
		logger.clear();
		logger.log('info', connectionInfo, 'connectionInfo', connectionInfo.hiddenKeys);
		
		if (connectionInfo.path && (connectionInfo.path || '').charAt(0) !== '/') {
			connectionInfo.path = '/' + connectionInfo.path;
		}

		thriftService.connect({
			host: connectionInfo.host,
			port: connectionInfo.port,
			username: connectionInfo.user,
			password: connectionInfo.password,
			authMech: 'NOSASL',
			version: connectionInfo.version,
			mode: connectionInfo.mode,
			configuration: {},
			options: {
				https: connectionInfo.isHTTPS,
				path: connectionInfo.path				
			}
		})(cb)(TCLIService, TCLIServiceTypes, {
			log: (message) => {
				logger.log('info', { message }, 'Query info')
			}
		});
	},

	disconnect: function(connectionInfo, cb){
		cb();
	},

	testConnection: function(connectionInfo, logger, cb){
		this.connect(connectionInfo, logger, cb);
	},

	getDbCollectionsNames: function(connectionInfo, logger, cb) {
		const { includeSystemCollection } = connectionInfo;

		this.connect(connectionInfo, logger, (err, session, cursor) => {
			if (err) {
				return cb(err);
			}
			const exec = cursor.asyncExecute.bind(null, session.sessionHandle);
			const execWithResult = getExecutorWithResult(cursor, exec);
			const getTables = getExecutorWithResult(cursor, cursor.getTables.bind(null, session.sessionHandle));

			execWithResult('show databases')
				.then(databases => databases.map(d => d.database_name))
				.then(databases => {
					async.mapSeries(databases, (dbName, next) => {
						const tableTypes = [ "TABLE", "VIEW", "GLOBAL TEMPORARY", "TEMPORARY", "LOCAL TEMPORARY", "ALIAS", "SYNONYM" ];
						
						if (includeSystemCollection) {
							tableTypes.push("SYSTEM TABLE");
						}
						getTables(dbName, tableTypes)
							.then((tables) => {
								return tables.map(table => table.TABLE_NAME)
							})
							.then(dbCollections => {
								next(null, {
									isEmpty: !Boolean(dbCollections.length),
									dbName,
									dbCollections
								})
							})
							.catch(err => next(err))
					}, cb);
				});
		});
	},

	getDbCollectionsData: function(data, logger, cb){
		const tables = data.collectionData.collections;
		const databases = data.collectionData.dataBaseNames;
		const pagination = data.pagination;
		const includeEmptyCollection = data.includeEmptyCollection;
		const recordSamplingSettings = data.recordSamplingSettings;
		const fieldInference = data.fieldInference;
	
		this.connect(data, logger, (err, session, cursor) => {
			if (err) {
				return cb(err);
			}

			async.mapSeries(databases, (dbName, nextDb) => {
				const exec = cursor.asyncExecute.bind(null, session.sessionHandle);
				const query = getExecutorWithResult(cursor, exec);
				const getPrimaryKeys = getExecutorWithResult(
					cursor,
					cursor.getPrimaryKeys.bind(null, session.sessionHandle)
				);
				const tableNames = tables[dbName] || [];

				exec(`use ${dbName}`)
					.then(() => query(`describe database ${dbName}`))
					.then((databaseInfo) => {
						async.mapSeries(tableNames, (tableName, nextTable) => {
							logger.progress({ message: 'Start sampling data', containerName: dbName, entityName: tableName });

							getLimitByCount(recordSamplingSettings, query.bind(null, `select count(*) as count from ${tableName}`))
								.then(countDocuments => {
									logger.progress({ message: 'Start getting data from database', containerName: dbName, entityName: tableName });

									return getDataByPagination(pagination, countDocuments, (limit, offset, next) => {
										query(`select * from ${tableName} limit ${limit} offset ${offset}`)
											.then(data => {
												logger.progress({ message: `${limit * (offset + 1)}/${countDocuments}`, containerName: dbName, entityName: tableName });
												next(null, data);
											}, err => next(err));
									});
								})
								.then((documents) => {
									logger.progress({ message: `Data has successfully got`, containerName: dbName, entityName: tableName });									

									const documentPackage = {
										dbName,
										collectionName: tableName,
										documents,
										indexes: [],
										bucketIndexes: [],
										views: [],
										validation: false,
										emptyBucket: false,
										containerLevelKeys: [],
										bucketInfo: {
											comments: _.get(databaseInfo, '[0].comment', '')
										}
									};

									if (fieldInference.active === 'field') {
										documentPackage.documentTemplate = _.cloneDeep(documents[0]);
									}

									return documentPackage;
								})
								.then((documentPackage) => {
									logger.progress({ message: `Start creating schema`, containerName: dbName, entityName: tableName });

									return Promise.all([
										query(`describe formatted ${tableName}`),
										query(`describe extended ${tableName}`),
										exec(`select * from ${tableName} limit 1`).then(cursor.getSchema),
									]).then(([formattedTable, extendedTable, tableSchema]) => {
										const tableInfo = hiveHelper
											.getFormattedTable(
												...cursor.getTCLIService(),
												cursor.getCurrentProtocol()
											)(formattedTable);
										const extendedTableInfo = hiveHelper.getDetailInfoFromExtendedTable(extendedTable);
										const sample = documentPackage.documents[0];
										documentPackage.entityLevel = entityLevelHelper.getEntityLevelData(tableName, tableInfo, extendedTableInfo);

										return {
											jsonSchema: hiveHelper.getJsonSchemaCreator(...cursor.getTCLIService(), tableInfo)(tableSchema, sample),
											relationships: convertForeignKeysToRelationships(dbName, tableName, tableInfo.foreignKeys || [])
										};
									}).then(({ jsonSchema, relationships }) => {
										logger.progress({ message: `Schema has created successfully`, containerName: dbName, entityName: tableName });
										
										return getPrimaryKeys(dbName, tableName)
											.then(keys => {
												keys.forEach(key => {
													jsonSchema.properties[key.COLUMN_NAME].primaryKey = true;
												});

												return jsonSchema;
											})
											.then(jsonSchema => {
												logger.progress({ message: `Primary keys have retrieved successfully`, containerName: dbName, entityName: tableName });

												return ({ jsonSchema, relationships });
											})
											.catch(err => {
												return Promise.resolve({ jsonSchema, relationships });
											});
									}).then(({ jsonSchema, relationships }) => {
										return query(`show indexes on ${tableName}`)
											.then(result => {
												return getIndexes(result);
											})
											.then(indexes => {
												logger.progress({ message: `Indexes have retrieved successfully`, containerName: dbName, entityName: tableName });
												
												documentPackage.entityLevel.SecIndxs = indexes;

												return { jsonSchema, relationships };
											})
											.catch(err => ({ jsonSchema, relationships }));
									}).then(({ jsonSchema, relationships }) => {
										if (jsonSchema) {
											documentPackage.validation = { jsonSchema };
										}

										return {
											documentPackage,
											relationships
										};
									});
								})
								.then((data) => {
									nextTable(null, data);
								})
								.catch(err => {
									nextTable(err)
								});
						}, (err, data) => {
							if (err) {
								nextDb(err);
							} else {
								nextDb(err, expandPackages(data));
							}
						});
					});
			}, (err, data) => {
				if (err) {
					logger.log('error', err);
					cb(err);
				} else {
					cb(err, ...expandFinalPackages(data));
				}
			});
		});
	}
};

const expandPackages = (packages) => {
	return packages.reduce((result, pack) => {
		result.documentPackage.push(pack.documentPackage);
		result.relationships = result.relationships.concat(pack.relationships);

		return result;
	}, { documentPackage: [], relationships: [] });
};

const expandFinalPackages = (packages) => {
	return packages.reduce((result, pack) => {
		result[0] = [...result[0], ...pack.documentPackage];
		result[2] = [...result[2], ...pack.relationships];

		return result;
	}, [[], null, []])
};

const getLimitByCount = (recordSamplingSettings, getCount) => new Promise((resolve, reject) => {
	if (recordSamplingSettings.active !== 'relative') {
		const absolute = Number(recordSamplingSettings.absolute.value);

		return resolve(absolute);
	}

	getCount().then((data) => {
		const count = data[0].count;
		const limit = Math.ceil((count * Number(recordSamplingSettings.relative.value)) / 100);
	
		resolve(limit);
	}).catch(reject);
});

const getPages = (total, pageSize) => {
	const generate = (size) => size <= 0 ? [0] : [...generate(size - 1), size];

	return generate(Math.ceil(total / pageSize) - 1);
};

const getDataByPagination = (pagination, limit, callback) => new Promise((resolve, reject) => {
	const getResult = (err, data) => err ? reject(err) : resolve(data);
	const pageSize = Number(pagination.value);

	if (!pagination.enabled) {
		return callback(limit, 0, getResult);
	}

	async.reduce(
		getPages(limit, pageSize),
		[],
		(result, page, next) => {
			callback(pageSize, page, (err, data) => {
				if (err) {
					next(err);
				} else {
					next(null, result.concat(data));
				}
			});
		},
		getResult
	);
});

const getExecutorWithResult = (cursor, handler) => {
	const resultParser = hiveHelper.getResultParser(...cursor.getTCLIService());
	
	return (...args) => {
		return handler(...args).then(resp => {
			return Promise.all([
				cursor.fetchResult(resp),
				cursor.getSchema(resp)
			]);
		}).then(([ resultResp, schemaResp ]) => {
			return resultParser(schemaResp, resultResp)
		});
	};
};

const convertForeignKeysToRelationships = (childDbName, childCollection, foreignKeys) => {
	return foreignKeys.map(foreignKey => ({
		relationshipName: foreignKey.name,
		dbName: foreignKey.parentDb,
		parentCollection: foreignKey.parentTable,
		parentField: foreignKey.parentField,
		childDbName: childDbName,
		childCollection: childCollection,
		childField: foreignKey.childField
	}));
};

const getIndexes = (indexesFromDb) => {
	const getValue = (value) => (value || '').trim();
	const getIndexHandler = (idxType) => {
		if (!idxType) {
			return 'org.apache.hadoop.hive.ql.index.compact.CompactIndexHandler';
		}
		
		if (idxType === 'compact') {
			return 'org.apache.hadoop.hive.ql.index.compact.CompactIndexHandler';
		}

		return idxType;
	};

	const getInTable = (tableName) => {
		return 'IN TABLE ' + tableName;
	};

	return (indexesFromDb || []).map(indexFromDb => {
		return {
			name: getValue(indexFromDb.idx_name),
			SecIndxKey: getValue(indexFromDb.col_names).split(',').map(name => ({ name: getValue(name) })),
			SecIndxTable: getInTable(getValue(indexFromDb.idx_tab_name)),
			SecIndxHandler: getIndexHandler(getValue(indexFromDb.idx_type)),
			SecIndxComments: getValue(indexFromDb.comment)
		};
	});
};
