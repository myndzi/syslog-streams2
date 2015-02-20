'use strict';

var Transform = require('stream').Transform,
    inherits = require('util').inherits,
    os = require('os');

var Producer = require('glossy').Produce;

var clone = require('clone'),
    tags = require('language-tags'),
    Joi = require('joi');

var bunyanRecord = Joi.object().keys({
    v: Joi.number().integer().min(0),
    level: Joi.number().integer().min(0).max(100),
    name: Joi.string(),
    hostname: Joi.string().hostname(),
    pid: Joi.number().integer().min(0),
    time: Joi.alternatives(Joi.date(), Joi.string()),
    msg: Joi.string()
});

var glossyRecord = Joi.object().keys({
    facility: Joi.string(),
    severity: Joi.string(),
    host: Joi.string().hostname(),
    appName: Joi.string(),
    pid: Joi.number().integer().min(0),
    date: Joi.date(),
    message: Joi.string(),
    structuredData: Joi.object()
});

var STRUCTURED_FIELDS = { timeQuality:1, origin:1, meta:1 };
var structuredData = Joi.object().keys({
    timeQuality: Joi.object().keys({
        tzKnown: Joi.number().integer().min(0).max(1),
        isSynced: Joi.number().integer().min(0).max(1),
        syncAccuracy: Joi.number().integer().min(0)
            .when('isSynced', { is: 0, then: Joi.any().forbidden() })
    }),
    origin: Joi.object().keys({
        ip: [
            Joi.string().hostname(),
            Joi.array().includes(
                Joi.string().hostname()
            )
        ],
        enterpriseId: Joi.string().regex(/^\d+(\.\d+)*$/),
        software: Joi.string().min(1).max(48),
        swVersion: Joi.string().min(1).max(48)
    }),
    meta: Joi.object().keys({
        sequenceId: Joi.number().integer().min(1).max(2147483647),
        sysUpTime: Joi.number().integer().min(0),
        language: Joi.string()
    })
});

function SyslogStream(opts) { // jshint maxcomplexity: 20
    Transform.call(this);
    
    this._writableState.objectMode = true;
    
    opts = opts || { };
    
    this.decodeBuffers = opts.hasOwnProperty('decodeBuffers') ? opts.decodeBuffers : false;
    this.decodeJSON = opts.hasOwnProperty('decodeJSON') ? opts.decodeJSON : false;
    this.useStructuredData = opts.hasOwnProperty('useStructuredData') ? opts.useStructuredData : !opts.type;
    this.defaultSeverity = opts.defaultSeverity || opts.defaultLevel || 'notice';
    var PEN = parseInt(opts.PEN, 10);
    this.PEN = !isNaN(PEN) ? PEN : null;
    
    this.glossy = new Producer({
        type: opts.type,
        facility: typeof opts.facility === 'string' ? opts.facility.toLowerCase() : 'local0',
        // severity: opts.severity || opts.level || 'info', -- this option doesn't get curried
        host: opts.host || opts.hostname || os.hostname() || '-',
        appName: opts.appName || opts.name || process.title || (process.argv && process.argv[0]) || '-',
        msgID: opts.msgID || opts.msgId || '-',
        pid: opts.pid || process.pid || '-'
    });
}
inherits(SyslogStream, Transform);

SyslogStream.prototype._transform = function (_record, NA, callback) { // jshint maxstatements: 25, maxcomplexity: 12
    var valid, str, record = clone(_record);
    
    if (this.decodeBuffers && Buffer.isBuffer(record)) {
        record = record.toString();
    }
    
    if (this.decodeJSON) {
        try { record = JSON.parse(record); }
        catch (e) { }
    }
    
    if (typeof record === 'string') {
        str = this.buildStringMessage(record);
    }
    
    if (!str && record && record.msg) {
        record.level = this.convertBunyanLevel(record.level);
        
        valid = Joi.validate(record, bunyanRecord, { allowUnknown: true, convert: true });
        if (valid.error === null) {
            str = this.buildBunyanMessage(valid.value);
        }
    }
    
    if (!str && record && record.message) {
        valid = Joi.validate(record, glossyRecord, { allowUnknown: false, convert: true });
        if (valid.error === null) {
            str = this.buildGlossyMessage(valid.value);
        }
    }
    
    if (!str || str === false) {
        str = this.buildJSONMessage(clone(_record));
    }
    
    this.push(str+'\n');
    callback();
};

SyslogStream.prototype.formatObject = function (obj) {
    var seen = [ ];
    
    return JSON.stringify(obj, function (key, val) {
        if (!val || typeof val !== 'object') { return val; }
        if (seen.indexOf(val) > -1) { return '[Circular]'; }
        seen.push(val);
        return val;
    });
};

SyslogStream.prototype.buildStringMessage = function (str) {
    return this.glossy.produce({
        severity: this.defaultSeverity,
        message: str
    });
};

SyslogStream.prototype.buildJSONMessage = function (obj) {
    return this.glossy.produce({
        severity: this.defaultSeverity,
        message: this.formatObject(obj)
    });
};

SyslogStream.prototype.buildGlossyMessage = function (record) {
    record.severity = record.severity || this.defaultSeverity;
    
    var structured = this.useStructuredData && record.structuredData ?
        this.validateStructuredData(record.structuredData) : { };
    
    if (structured.data) {
        record.structuredData = structured.data;
    }
    
    if (structured.extra) {
        record.message += ' ' + this.formatObject(structured.extra);
    }

    return this.glossy.produce(record);
};


var BUNYAN = {
    FATAL: 60,
    ERROR: 50,
    WARN: 40,
    INFO: 30,
    DEBUG: 20,
    TRACE: 10
};
var SYSLOG = {
    LEVEL: {
        EMERG: 0, 0: 'emerg',
        ALERT: 1, 1: 'alert',
        CRIT: 2, 2: 'crit',
        ERR: 3, 3: 'err',
        WARNING: 4, 4: 'warn',
        NOTICE: 5, 5: 'notice',
        INFO: 6, 6: 'info',
        DEBUG: 7, 7: 'debug'
    }
};
var bunyanFields = { facility:1, level:1, hostname:1, name:1, pid:1, time:1, msg:1, msgId:1, v:1 };
SyslogStream.prototype.buildBunyanMessage = function (source) {
    var extra = Object.keys(source).filter(function (key) {
        return !(key in bunyanFields);
    }).reduce(function (acc, key) {
        acc[key] = source[key];
        return acc;
    }, { });
    
    var structured = this.useStructuredData ?
        this.validateStructuredData(extra) :
        Object.keys(extra).length ? { extra: extra } : { };
        
    return this.glossy.produce({
        facility: source.facility,
        severity: SYSLOG.LEVEL[source.level],
        host: source.hostname,
        appName: source.name,
        pid: source.pid,
        date: source.time,
        msgID: source.msgId,
        message: source.msg + (structured.extra ? ' ' + this.formatObject(structured.extra) : ''),
        structuredData: structured.data
    });
};
SyslogStream.prototype.convertBunyanLevel = function (level) { // jshint maxstatements: 18, maxcomplexity: 10
    if (typeof level === 'string') { level = BUNYAN[level.toUpperCase()]; }
    level = parseInt(level, 10);
    
    if (isNaN(level)) { level = BUNYAN.INFO; }
    
    if (level >= BUNYAN.FATAL) { return SYSLOG.LEVEL.EMERG; }
    if (level >= BUNYAN.ERROR) { return SYSLOG.LEVEL.ERR; }
    if (level >= BUNYAN.WARN)  { return SYSLOG.LEVEL.WARNING; }
    if (level >= BUNYAN.INFO)  { return SYSLOG.LEVEL.NOTICE; }
    if (level >= BUNYAN.DEBUG) { return SYSLOG.LEVEL.INFO; }
    /*if (level >= 0) /*TRACE*/  return SYSLOG.LEVEL.DEBUG;
};

var INVALID_SDID = /[^\u0020-\u007e]|[@=\]"\s]/;
SyslogStream.prototype.validateStructuredData = function (obj) {
    var structured = { data: { }, extra: { } };
    
    var result = Joi.validate(obj, structuredData, { stripUnknown: true, convert: true });
    if (result.error === null &&
        obj.meta &&
        obj.meta.language &&
        !tags.check(obj.meta.language))
    {
        result.error = 'Invalid language tag';
    }
    
    if (result.error === null) {
        structured.data = result.value;
    } else {
        structured.extra.SD_VALIDATION_ERROR = result.error.message || result.error;
    }
    
    Object.keys(obj).filter(function (key) {
        return !(key in STRUCTURED_FIELDS);
    }).forEach(function (key) {
        var kv = obj[key];
        
        if (this.PEN &&
            !(INVALID_SDID.test(key)) &&
            kv && typeof kv === 'object' &&
            !(kv instanceof Date) &&
            !(kv instanceof RegExp))
        {
            structured.data[key + '@' + this.PEN] = obj[key];
        } else {
            structured.extra[key] = obj[key];
        }
    }, this);
    
    if (Object.keys(structured.extra).length === 0) { structured.extra = null; }
    if (Object.keys(structured.data).length === 0) { structured.data = null; }
    
    
    return structured;
};

module.exports = SyslogStream;
