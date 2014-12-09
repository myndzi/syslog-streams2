# Syslog-Streams2

Syslog protocol as a Node Transform stream.

# Usage

    var SyslogStream = require('syslog-streams2');
    var stream = new SyslogStream();
	stream.write('foo');

# Options

Some options are supported:

    new SyslogStream({
		decodeBuffers: <boolean>,
		decodeStrings: <boolean>,
		useStructuredData: <boolean>,
		defaultSeverity: <string>,
		PEN: <integer>,
		
		type: <string>,
		facility: <string>,
		host: <string>,
		appName: <string>,
		msgId: <string>,
		pid: <integer>
	});

The first set of options apply to the stream itself and how it handles incoming data. The second set of options are curried into the glossy instance that performs the translation.

### decodeBuffers
True to decode buffers written to the stream; false to do nothing. You should be writing objects to the stream, but it could be handy when piping from other locations. Defaults to false.

### decodeJSON
True to attempt to decode strings as JSON; false to do nothing. May be used in conjunction with decodeBuffers. Defaults to false.

### useStructuredData
True to attempt to encode structured data; false to do nothing. Defaults to true unless 'type' is set (more on that below).

### defaultSeverity
The default severity of a log message, if not specified. This is used for all messages interpreted as strings or invalid bunyan/glossy records, and bunyan or glossy records that do not specify a level/severity.

### PEN
If you have a Private Enterprise Number, specify it here. Non-standardized structured data is tagged with your PEN. To strictly conform to the spec, you should not use this unless you have registered a PEN with IANA.

### type
This is passed along to glossy to specify what type of output to create. Right now, 'BSD' is the only valid option, to be used if you want to output 'old style' RFC3164-compatible messages. Leave empty for RFC5424-style messages. Glossy's documentation mentions RFC 5848, but no references currently exist in the code, so these are the only two options.

### facility
The facility to log to. Case insensitive. Defaults to `local0`. Can be overridden in `.write()`.

Valid facilities are:
	
	KERN - Kernel messages
	USER - User-level messages
	MAIL - Mail system
	DAEMON - System daemons
	AUTH - Security/authorization messages
	SYSLOG - Messages generated internally by syslogd
	LPR - Line printer subsystem
	NEWS - Network news subsystem
	UUCP - UUCP subsystem
	CLOCK - Clock daemon
	SEC - Security/authorization messages
	FTP - FTP daemon
	NTP - NTP subsystem
	AUDIT - Log audit
	ALERT - Log alert
	LOCAL0 - Local use 0
	LOCAL1 - Local use 1
	LOCAL2 - Local use 2
	LOCAL3 - Local use 3
	LOCAL4 - Local use 4
	LOCAL5 - Local use 5
	LOCAL6 - Local use 6
	LOCAL7 - Local use 7

### host
The hostname of the system generating the log message. Defaults to `os.hostname()`, falls back on the nil value(`-`). Can be overriden in `.write()`.

From RFC5424:

	The HOSTNAME field SHOULD contain the hostname and the domain name of
	the originator in the format specified in STD 13 [RFC1034].  This
	format is called a Fully Qualified Domain Name (FQDN) in this
	document.
	
	In practice, not all syslog applications are able to provide an FQDN.
	As such, other values MAY also be present in HOSTNAME.  This document
	makes provisions for using other values in such situations.  A syslog
	application SHOULD provide the most specific available value first.
	The order of preference for the contents of the HOSTNAME field is as
	follows:
		
	1. FQDN
	2. Static IP address
	3. hostname
	4. Dynamic IP address
	5. the NILVALUE

### pid
The process id of the process generating the log message. Defaults to `process.pid`, falls back on the nil value(`-`). Can be overridden in `.write()`. 

### appName
The app name to use when logging messages. Defaults to `process.title`, falls back on `process.argv[0]` followed by the nil value(`-`). Can be overriden in `.write()`.

	The APP-NAME field SHOULD identify the device or application that
	originated the message.  It is a string without further semantics.
	It is intended for filtering messages on a relay or collector.


### msgId
The message id to use when logging messages. Defaults to the nil value. Can be overriden in `.write()`.

	The MSGID SHOULD identify the type of message.  For example, a
	firewall might use the MSGID "TCPIN" for incoming TCP traffic and the
	MSGID "TCPOUT" for outgoing TCP traffic.  Messages with the same
	MSGID should reflect events of the same semantics.  The MSGID itself
	is a string without further semantics.  It is intended for filtering
	messages on a relay or collector.  

# Notes

Data is handled slightly differently based on the input. Bunyan-style records are identified by the presence of a `msg` key and validated against Bunyan's record format. Glossy-style records are identified by the presence of a `message` key and validated against Glossy's record format.

Records that fail validation, or that return `false` when run through Glossy will be converted to JSON and written as a plain string. 

### Structured data from Bunyan records
When possible, extra object keys will be processed into structured data. There are two cases where this will happen.

- When you provide a key matching a defined SDID in the RFC, such as 'timeQuality', 'origin', or 'meta'
- When you provide a PEN

**Note:** Object properties that do not contain objects cannot be converted to structured data (e.g. `{ custom: 'foo', msg: 'hello' }`; neither can properties with keys that violate the acceptable characters for an SDID, e.g. `{ 'foo@bar': 'baz', msg: 'hello' }`.

Standardized SDIDs will be validated and converted. Any remaining keys will be treated as custom structured data and formatted with your PEN.

Example:

`log.write({ meta: { ip: '127.1.1.1' }, msg: 'hello' })`

outputs:

`<149>1 2014-12-05T23:01:36.170Z myndzi node 20465 - [meta ip="127.1.1.1"] hello` 

while

`log.write({ custom: { key: 'val' }, msg: 'hello' })`

outputs:

`<149>1 2014-12-05T23:03:58.957Z myndzi node 20492 - [custom@32473 key="val"] hello`

### Structured data from Glossy records
In general, the same as above, with the exception that glossy's format makes structured data explicit in its structure, so no "implying" is done by exclusion in the way that it is done for Bunyan.

# Tests

Clone and run `npm test`. Currently 75 tests and 100% coverage.