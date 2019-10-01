var util = require('util');
var url = require('url');
var request = require('request');
var futils = require('./fhutils');
var optval = require('optval');
var fhutils;
var call;
var config;
var widget;
var cache;
var debug = require('debug')('fh-mbaas-api:act');

module.exports = function(cfg) {
  if (!cfg) {
    return;
  }
  config = cfg;
  widget = config.fhapi.widget;
  fhutils = new futils(cfg);
  call = require('./call')(cfg);
  cache = require('./cache')(cfg);
  return act();
};

/**
 * description: fh.act is the server side equivilant of the client side $fh.act.
 * It allows one app to call anothers endpoints which means several apps can share the same
 * state information held by another app
 * @param params {guid:"",endpoint:"",params:{}}
 * @param cb function
 */
var act = function() {
  //private set up stuff
  var ERRORS = {
    "InvalidCallback": "$fh.act requires the final parameter to be a function",
    "InvalidArgument": "The param %s is invalid it is required to be a %s",
    "MissingArgument": "The param %s is missing",
    "MissingParms": "params is missing",
    "InvalidGuid": "The app identifier (guid) is invalid %s . Please check it.",
    "HostNotFound": "Unable to determine hostname for target app %s",
    "InternalError": "Internal Error. Unable to complete lookup."
  };

  function validateParams(params) {
    if (!params || 'object' !== typeof params) {
      return ERRORS.MissingParms;
    }
    if (!params.hasOwnProperty('guid') || 'string' !== typeof params.guid) {
      return util.format(ERRORS.InvalidArgument, "guid", "string");
    }
    // Limitations on guid from here https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
    if (params.guid.length <= 63 && /^[a-zA-Z0-9][a-zA-Z0-9\.\-_]*[a-zA-Z0-9]$/.test(params.guid)) {
      return util.format(ERRORS.InvalidGuid, params.guid);
    }
    if (params.hasOwnProperty('params') && 'object' !== typeof params['params']) {
      return util.format(ERRORS.InvalidArgument, "params", "object");
    }
    // @INFO It seems that are supporting two different apis here for backwards compatibility
    if (!(params.hasOwnProperty('path') || params.hasOwnProperty('endpoint') )) {
      return 'Either "path" or "endpoint" is required.';
    }
  }

  function doAppCall(callurl, actParams, reqParams, cb) {

    callurl = url.parse(callurl);

    var urlStr = url.format({
      host: callurl.host,
      protocol: callurl.protocol,
      pathname: (actParams.path) ?
        fhutils.urlPathJoin(callurl.pathname, actParams.path) :
        fhutils.urlPathJoin(callurl.pathname, 'cloud', actParams.endpoint)
    });

    var headers = optval(actParams.headers, {});
    headers["accept"] = "application/json";
    headers["x-request-with"] = widget;

    var reqOpts = {
      url: urlStr,
      headers: headers,
      method: optval(actParams.method, "POST"),
      timeout: optval(actParams.timeout, 60000),
      json: optval(actParams.json, true)
    };

    if (reqOpts.method.toLowerCase() === 'get') {
      reqOpts.qs = reqParams;
    } else {
      reqOpts.json = reqParams;
    }

    request(reqOpts, function(error, response, body) {
      return cb(error, body, response);  // would prefer the same order as request, but maintaining backward compatibility with earlier flawed api
    });

  }

  //return our public function
  return function(params, cb) {
    if ('function' !== typeof cb) {
      throw {
        name: "InvalidCallback",
        message: ERRORS.InvalidCallback
      };
    }

    var error = validateParams(params);
    if (error) {
      return cb(error);
    }

    var host = 'http://' + params.host,
        callback = cb,
        funcParams = params.params || {};

    // @INFO : For development - I assume we don't want this
    if (process.env.FH_SERVICE_MAP) {
      // For local development, we will provide the service <==> hostname:port mapping in gruntfile.
      debug('LOCAL service map : %s', util.inspect(process.env.FH_SERVICE_MAP));
      var hasUrl = false,
        serviceMap;

      try {
        serviceMap = JSON.parse(process.env.FH_SERVICE_MAP);
        if (serviceMap[params.guid]) {
          hasUrl = true;
        } else {
          return cb('Unable to find mapping for guid ' + params.guid + '  in service map from FH_SERVICE_MAP environment variable');
        }
      } catch (e) {
        return cb('Unable to parse local service map from FH_SERVICE_MAP environment variable');
      }

      // Do the HTTP request outside of the try catch block so that any errors are raised correctly and not swallowed by the catch block
      if (hasUrl) {
        host = serviceMap[params.guid];
      }
    }

    doAppCall(host, params, funcParams, callback);
  };
};
