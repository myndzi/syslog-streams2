'use strict';

var SyslogStream = require('./index'),
    format = require('util').format;

require('should');

var TEST = {
    NAME: 'Test',
    MSG_ID: 'FOOMSG',
    PEN: 12343,
    FACILITY: 'LOCAL3',
    HOSTNAME: '127.0.1.1'
};

var syslogRegex = new RegExp(format(
    '^<\\d+>\\d [\\d\\-.T:Z]+ %s %s \\d+ %s \\S',
    TEST.HOSTNAME,
    TEST.NAME,
    TEST.MSG_ID
));
var ISOStringRegex = /"[\d\-.T:Z]+"$/;

var BUNYAN = {
    FATAL: 60,
    ERROR: 50,
    WARN: 40,
    INFO: 30,
    DEBUG: 20,
    TRACE: 10
};
var SYSLOG = {
    VERSION: 1,
    NILVALUE: '-',
    LEVEL: {
        EMERG: 0,
        ALERT: 1,
        CRIT: 2,
        ERR: 3,
        WARNING: 4,
        NOTICE: 5,
        INFO: 6,
        DEBUG: 7
    },
    FACILITY: {
        KERN: 0,
        USER: 1,
        MAIL: 2,
        DAEMON: 3,
        AUTH: 4,
        SYSLOG: 5,
        LPR: 6,
        NEWS: 7,
        UUCP: 8,
        CLOCK: 9,
        AUTHPRIV: 10,
        FTP: 11,
        NTP: 12,
        LOG_AUDIT: 13,
        LOG_ALERT: 14,
        CRON: 15,
        LOCAL0: 16,
        LOCAL1: 17,
        LOCAL2: 18,
        LOCAL3: 19,
        LOCAL4: 20,
        LOCAL5: 21,
        LOCAL6: 22,
        LOCAL7: 23
    }
};
describe('Message parsing', function () {
    var syslog, stream;
    
    // cheating - relying on emit's synchronous behavior
    function getMsg(r) {
        var msg;
        syslog.once('data', function (chunk) {
            msg = chunk.toString();
        });
        syslog.write(r);
        return msg.replace(/\r?\n$/, '');
    }
    function getHeader(r) {
        var msg = getMsg(r);
        return msg.split(' ').slice(0, 6).join(' ');
    }
    
    beforeEach(function () {
        syslog = new SyslogStream({
            name: TEST.NAME,
            msgId: TEST.MSG_ID,
            PEN: TEST.PEN,
            facility: TEST.FACILITY,
            hostname: TEST.HOSTNAME
        });
    });
    
    afterEach(function (done) {
        syslog.end(done);
    });

    describe('message', function () {
        it('should accept plain text strings', function () {
            getMsg('foo').should.match(syslogRegex);
        });
        it('should return JSON encoded messages for arrays', function () {
            getMsg([null, 'foo']).should.match(/\[null,"foo"\]$/);
        });
        it('should return an ISO Date string for Date objects', function () {
            getMsg(new Date()).should.match(ISOStringRegex);
        });
        it('should interpret other primitives as strings', function () {
            getMsg(true).should.match(/true$/);
            getMsg(123).should.match(/123$/);
        });
        it('should use the \'msg\' field of a record as the message if it exists', function () {
            getMsg({
                msg: 'msgKey'
            }).should.match(/msgKey$/);
        });
    });
    describe('header', function () {
        function priority(level, facility) {
            level = syslog.convertBunyanLevel(level);
            return new RegExp(format('^<%d>1$', facility * 8 + level));
        }
        function header(rec, token) {
            if (arguments.length === 1) {
                return getHeader({ msg: 'foo' }).split(' ')[rec];
            }
            rec.msg = rec.msg || 'foo';
            return getHeader(rec).split(' ')[token];
        }

        describe('priority', function () {
            var DEF_FACILITY = SYSLOG.FACILITY[TEST.FACILITY];
            it('should default the level to BUNYAN.INFO', function () {
                header(0).should.match(priority(BUNYAN.INFO, DEF_FACILITY));
            });
            it('should reflect explicitly specified levels', function () {
                header({ level: 'fatal' }, 0).should.match(priority(BUNYAN.FATAL, DEF_FACILITY));
            });
        });
        
        describe('time', function () {
            it('should default the timestamp to the current time', function () {
                var now = new Date();
                var ts = new Date(header(1));

                Math.abs(now-ts).should.be.within(0, 10);
            });
            it('should use the provided timestamp if given', function () {
                var then = new Date();
                then.setFullYear(then.getFullYear() - 1);

                header({ time: then }, 1).should.equal(then.toISOString());
            });
            it('should use the NILVALUE if given false for the timestamp', function () {
                header({ time: 'foo' }, 1).should.equal(SYSLOG.NILVALUE);
            });
        });
        describe('hostname', function () {
            it('should default to the specified hostname', function () {
                header(2).should.equal(TEST.HOSTNAME);
            });
            it('should reflect explicitly specified hostname', function () {
                header({ hostname: 'foo.bar' }, 2).should.equal('foo.bar');
            });
            it('should fall back on NILVALUE', function () {
                var _hostname = syslog.glossy.host;
                syslog.glossy.host = null;
                header(2).should.equal(SYSLOG.NILVALUE);
                syslog.glossy.host = _hostname;
            });
        });
        describe('appName', function () {
            it('should default to the specified appName', function () {
                header(3).should.equal(TEST.NAME);
            });
            it('should reflect explicitly specified appName', function () {
                header({ name: 'keke' }, 3).should.equal('keke');
            });
            it('should fall back on NILVALUE', function () {
                var _appName = syslog.glossy.appName;
                delete syslog.glossy.appName;
                header(3).should.equal(SYSLOG.NILVALUE);
                syslog.glossy.appName = _appName;
            });
        });
        describe('procId', function () {
            it('should default to process.pid', function () {
                header(4).should.eql(String(process.pid));
            });
            it('should reflect explicitly specified procId', function () {
                header({ pid: 123 }, 4).should.equal('123');
            });
            it('should use process.pid if not given a valid integer', function () {
                header({ pid: 'foo' }, 4).should.eql(String(process.pid));
                header({ pid: -2 }, 4).should.eql(String(process.pid));
            });
            it('should fall back on NILVALUE', function () {
                var _pid = syslog.glossy.pid;
                delete syslog.glossy.pid;
                header(4).should.equal(SYSLOG.NILVALUE);
                syslog.glossy.pid = _pid;
            });
        });
        describe('msgId', function () {
            it('should default to the specified msgId', function () {
                header(5).should.equal(TEST.MSG_ID);
            });
            it('should reflect explicitly specified msgId', function () {
                header({ msgId: 'unf' }, 5).should.equal('unf');
            });
            it('should fall back on NILVALUE', function () {
                var _msgId = syslog.glossy.msgID;
                delete syslog.glossy.msgID;
                header(5).should.equal(SYSLOG.NILVALUE);
                syslog.glossy.msgID = _msgId;
            });
        });
    });
    describe('structured data', function () {
        function SD(r) {
            r.msg = 'foo';
            var msg = getMsg(r);

            var matched = msg.split(' ').slice(6).join(' ').replace(/\\\\/, '').match(/(\[(\\\]|[^\]])+\])+/);
            
            return matched ? matched[0] : '';
        };
        
        describe('standard SDIDs', function () {
            describe('timeQuality', function () {
                it('should validate with no arguments', function () {
                    SD({
                        timeQuality: { }
                    }).should.equal('[timeQuality]');
                });
                it('should accept tzKnown', function () {
                    SD({
                        timeQuality: { tzKnown: 1 }
                    }).should.equal('[timeQuality tzKnown="1"]');
                });
                it('should error if tzKnown is invalid', function () {
                    [null, 1.2, 3, -1, Infinity, { }].forEach(function (val) {
                        SD({ timeQuality: { tzKnown: val } }).should.equal('');
                    });
                });
                it('should accept isSynced', function () {
                    SD({
                        timeQuality: { isSynced: 0 }
                    }).should.equal('[timeQuality isSynced="0"]');
                });
                it('should error if isSynced is invalid', function () {
                    [null, 1.2, 3, -1, Infinity, { }].forEach(function (val) {
                        SD({ timeQuality: { isSynced: val} }).should.equal('');
                    });
                });
                it('should accept syncAccuracy', function () {
                    // Joi counts isSynced being undefined as being defined as 0,
                    // so must specify 'isSynced' here even though it's not required by the RFC
                    SD({
                        timeQuality: { isSynced: 1, syncAccuracy: 123 }
                    }).should.equal('[timeQuality isSynced="1" syncAccuracy="123"]');
                });
                it('should error if syncAccuracy is supplied when isSynced is 0', function () {
                    var rec = { timeQuality: { isSynced: 0, syncAccuracy: 123 } };
                    SD(rec).should.equal('');
                    rec.msg = 'foo';
                    getMsg(rec).should.match(/syncAccuracy is not allowed/);
                });
            });
            describe('origin', function () {
                it('should validate with no arguments', function () {
                    SD({ origin: { } }).should.equal('[origin]');
                });
                it('should accept a single ip', function () {
                    SD({ origin: { ip: '127.0.0.1' } }).should.equal('[origin ip="127.0.0.1"]');
                });
                it('should accept a single hostname', function () {
                    SD({ origin: { ip: 'foo' } }).should.equal('[origin ip="foo"]');
                    SD({ origin: { ip: 'foo.bar' } }).should.equal('[origin ip="foo.bar"]');
                });
                it('should error on an invalid parameter for \'ip\'', function () {
                    var rec = { origin: { ip: '.' } };
                    SD(rec).should.equal('');
                    rec.msg = 'foo';
                    getMsg(rec).should.match(/ip must be a valid hostname/);
                });
                it('should accept an array', function () {
                    SD({ origin: { ip: ['127.0.0.1', '127.0.0.2'] } }).should.equal('[origin ip="127.0.0.1" ip="127.0.0.2"]');
                });
                it('should accept an enterpriseId', function () {
                    SD({ origin: { enterpriseId: '1234' } }).should.equal('[origin enterpriseId="1234"]');
                });
                it('should accept a software name', function () {
                    SD({ origin: { software: 'poop' } }).should.equal('[origin software="poop"]');
                });
                it('should accept a software version', function () {
                    SD({ origin: { swVersion: '4242' } }).should.equal('[origin swVersion="4242"]');
                });
            });
            describe('meta', function () {
                it('should validate with no arguments', function () {
                    SD({ meta: { } }).should.equal('[meta]');
                });
                // probably could/should implement this into the code
                it('should accept a sequence id', function () {
                    SD({ meta: { sequenceId: 1 } }).should.equal('[meta sequenceId="1"]');
                });
                it('should accept system uptime', function () {
                    SD({ meta: { sysUpTime: 1234 } }).should.equal('[meta sysUpTime="1234"]');
                });
                it('should accept a language', function () {
                    SD({ meta: { language: 'en-us' } }).should.equal('[meta language="en-us"]');
                });
                it('should error on an invalid BCP_47 language tag', function () {
                    ['en_US', 1234, 'jabberwocky', null].forEach(function(val) {
                        SD({ meta: { language: val } }).should.equal('');
                    });
                });
            });
            it('should accept everything', function () {
                SD({
                    timeQuality: {
                        tzKnown: 1,
                        isSynced: 1,
                        syncAccuracy: 123
                    },
                    origin: {
                        ip: ['127.0.0.1', 'foo.bar'],
                        enterpriseId: '3434.34355',
                        software: 'keke',
                        swVersion: '1.2.3'
                    },
                    meta: {
                        sequenceId: 55,
                        sysUpTime: 21355,
                        language: 'fr'
                    }
                }).should.equal(
                    '[timeQuality tzKnown="1" isSynced="1" syncAccuracy="123"]'+
                    '[origin ip="127.0.0.1" ip="foo.bar" enterpriseId="3434.34355" software="keke" swVersion="1.2.3"]'+
                    '[meta sequenceId="55" sysUpTime="21355" language="fr"]'
                );
            });
        });
        describe('custom SDIDs', function () {
            var PEN = TEST.PEN;
            it('should format any extra keys as structured data; SDID should contain the PEN', function () {
                SD({ foo: { bar: 123 } }).should.equal('[foo@'+PEN+' bar="123"]');
            });
            it('should not create any structured data if there is no PEN', function () {
                var _useSD = syslog.useStructuredData;
                syslog.useStructuredData = false;
                SD({ foo: { bar: 123 } }).should.equal('');
                syslog.useStructuredData = _useSD;
            });
            it('should not format keys that are not maps', function () {
                ['bar', new Date(), true, /./].forEach(function (val) {
                    var rec = { foo: val };
                    SD(rec).should.equal('');
                    rec.foo.should.equal(val);
                    rec.should.not.have.property('SD_VALIDATION_ERROR');
                });
            });
            it('should not format keys that are illegal SDID values', function () {
                var rec = { '@': { invalid: 'true' } };
                SD(rec).should.equal('');
                rec['@'].invalid.should.equal('true');
                rec.should.not.have.property('SD_VALIDATION_ERROR');
            });
            it('should accept arrays', function () {
                SD({ foo: { bar: [ 1, 2, 3 ] } }).should.equal('[foo@'+PEN+' bar="1" bar="2" bar="3"]');
            });
        });
    });
    describe('write', function () {
        it('should provide any data not converted to structured data as JSON', function () {
            getMsg({
                msg: 'hai',
                '@': 'foo'
            }).should.match(/{"@":"foo"}$/);
        });
        it('should not be destructive to the passed object', function () {
            var rec = { level: 'warn', msg: 'foo' };
            syslog.write(rec);
            rec.should.eql({
                level: 'warn',
                msg: 'foo'
            });
        });
        it('should convert a buffer to a string', function () {
            var _decodeBuffers = syslog.decodeBuffers;
            syslog.decodeBuffers = true;
            getMsg(new Buffer('foo')).should.match(/foo$/);
            syslog.decodeBuffers = _decodeBuffers;
        });
        it('should decode JSON if possible', function () {
            var _decodeJSON = syslog.decodeJSON;
            syslog.decodeJSON = true;
            getMsg('{"msg":"foo"}').should.match(/foo$/);
            syslog.decodeJSON = _decodeJSON;
        });
    });
    describe('formatObject', function () {
        it('should flag circular references', function () {
            var obj = { };
            obj.foo = obj;
            getMsg(obj).should.match(/\{"foo":"\[Circular\]"\}$/);
        });
    });
});