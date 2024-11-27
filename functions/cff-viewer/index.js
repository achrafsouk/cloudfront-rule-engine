import cf from 'cloudfront';
const crypto = require('crypto');
const kvsId = '__KVS_ID__';
const kvsHandle = cf.kvs(kvsId);
const rulesKey = 'rules';
var rand;

async function handler(event) {
    var req = event.request;
    rand = event.context.requestId;

    try {
        const rules = await fetchRules();
        const matchingRuleId = getMatchingRuleId(req, rules);
        console.log("matchingRuleId = " + matchingRuleId);
        const matchingRuleActions = await getRuleActions(matchingRuleId);
        return applyActions(req, matchingRuleActions);
        
    } catch (err) {
        console.log(err);
        if (err instanceof EvalError) {
            throw new Error('no matching rule, fail close');
        } else {
            return {
                statusCode: 500,
                statusDescription: 'Internal Server Error',
                body: {
                    'encoding': 'text',
                    'data': err.message
                }
                
            };
        }
    }
}

async function fetchRules() {
    try {
        const rulesString = await kvsHandle.get(rulesKey);
        return JSON.parse(rulesString);
    } catch (err) {
        console.log(err);
        throw new Error('failed to fetch/parse rules');
    }
}

function getMatchingRuleId(req, rules) {
    for (var ruleId in rules) {
        if (evaluateRule(req, rules[ruleId])) {
            return ruleId;
        }
    }
    throw new EvalError("No matching rules found for " + JSON.stringify(req));
}

function evaluateRule(req, rule) {
    try {
        const op = Object.keys(rule)[0];
        const args = rule[op];
        var values;
        
        switch(op) {
          case '&':
            var resAnd = true;
            for (var argAnd in args) {
                if (!evaluateRule(req, args[argAnd])) {
                    resAnd = false;
                    break;
                }
            }
            return resAnd;
          case '|':
            var resOr = false;
            for (var argOr in args) {
                if (evaluateRule(req, args[argOr])) {
                    resOr = true;
                    break;
                }
            }
            return resOr;
          case '=':
            values = getFields(req, args);
            if (values) return values[0] === values[1];
            return false;
          case '!':
            return !evaluateRule(req, args);
          case 'contain':
            values = getFields(req, args);
            if (values) return values[0].includes(values[1]);
            return false;
          case 'exist': 
            values = getFields(req, args);
            if (['true', 'false'].includes(values[1])) return ( (values[0] && values[1] === 'true') || (!values[0] && values[1] === 'false'));
            throw new Error('exist op paramters are not valid.');
          case 'startwith':
            values = getFields(req, args);
            return values[0].startsWith(values[1]);
          case 'endwith':
            values = getFields(req, args);
            return values[0].endsWith(values[1]);
          case 'match':
            values = getFields(req, args);
            const regEx = new RegExp(values[1]);
            return regEx.test(values[0]);
          default:
            throw new Error('requested rule evaluation opration does not exist');
        }
    } catch (err) {
        console.log(err);
        throw new Error('Error in evaluating rule part ='+JSON.stringify(rule));
    }
}

function getFields(req, object) {
    try {
        const attr = Object.keys(object)[0];
        switch (attr) {
            case 'uri':
                return [req.uri, object['uri'] ];
            case 'header':
                const hName = Object.keys(object['header'])[0];
                if (req.headers[hName]) {
                    return [req.headers[hName].value, object['header'][hName]];                 
                } else {
                    return [null, object['header'][hName]];
                }
                break;
            case 'qs':
                const qsName = Object.keys(object['header'])[0];
                if (req.querystring[qsName]) {
                    return [req.querystring[qsName].value, object['qs'][qsName]];
                } else {
                    return [null, object['qs'][qsName]];
                }
                break;
            case 'cookie':
                const cookieName = Object.keys(object['cookie'])[0];
                if (req.cookies[cookieName]) {
                    return [req.cookies[cookieName].value, object['cookie'][cookieName]];
                } else {
                    return [null, object['cookie'][cookieName]];
                }
                break;
            default:
                throw new Error('invalid rule attribute for comparison');
        }
    } catch (err) {
        console.log(err);
        throw new Error('Error in applying rule op');
    }
}

async function getRuleActions(ruleId) {
    try {
        const ruleActionsString = await kvsHandle.get(ruleId);
        return JSON.parse(ruleActionsString);
    } catch (err) {
        console.log(err);
        throw new Error('lookup/parsing failed for ruleID ='+ruleId);
    }
}

function applyActions(inputObj, actions) {
    var returnObj = inputObj;
    try {
        const op = Object.keys(actions)[0];
        const args = actions[op];
    
        switch(op) {
          case 'forward':
            const auth = args["auth"];
            if(auth) {
                const key = args["auth"]["key"];
                if (!key) throw new Error('auth action missing key');
                if (!(returnObj.cookies && returnObj.cookies["session"] && returnObj.cookies["session"].value)) throw new Error('session cookie malformed');
                try { 
                    const segs = returnObj.cookies["session"].value.split('.');
                    if (segs.length !== 3) throw new Error('jwt malformed');
                    const payload = JSON.parse(Buffer.from(segs[1], 'base64url'));
                    const a = segs[2];
                    const b = crypto.createHmac('sha256', key).update([segs[0], segs[1]].join('.')).digest('base64url');
                    if (a.length != b.length) throw new Error('bad signature');
                    var xor = 0;
                    for (var i = 0; i < a.length; i++) {
                        xor |= (a.charCodeAt(i) ^ b.charCodeAt(i));
                    }
                    if (!(0 === xor)) throw new Error('bad signature');
                    if (payload.nbf && Date.now() < payload.nbf*1000) throw new Error('Token not yet active');
                    if (payload.exp && Date.now() > payload.exp*1000) throw new Error('Token expired');
                }
                catch(e) {
                    console.log(e);
                    return {
                        statusCode: 401,
                        statusDescription: 'Unauthorized'
                    };
                }
            }
            const caching = args["caching"];
            if(caching) {
                if (caching === "bust") {
                    if (!returnObj.headers) returnObj['headers'] = {};
                    returnObj.headers["x-cache-key"] = {"value": getRand()};
                }
            }
            const origin = args["origin"];
            // TODO make it more sofisticated for origin properties
            if(origin) {
                if (origin.includes('s3.amazonaws.com') {
                    cf.updateRequestOrigin({
                        "domainName" : origin,
                        "originAccessControlConfig": {
                                "enabled": true,
                                "signingBehavior": "always",
                                "signingProtocol": "sigv4",
                                "originType": "s3"
                            }
                    });
                } else {
                    cf.updateRequestOrigin({
                        "domainName" : origin,
                        "timeouts": {
                            "readTimeout": 30,
                            "connectionTimeout": 5
                        }
                    });
                }
            } else throw new Error('Origin missing in forward action');
            const reqHeaders = args["setReqHeaders"];
            if (reqHeaders) {
                try {
                    for (var reqHeader in reqHeaders) {
                        if (!returnObj.headers) returnObj['headers'] = {};
                        returnObj.headers[reqHeader] = {"value": reqHeaders[reqHeader]};
                    }
                } catch (err) {
                    console.log(err);
                    throw new Error('header directive malformed in action');
                }
            }
            const changeUri = args["changeUri"];
            if (changeUri) {
                returnObj.uri = changeUri;
            }
            return returnObj;
          case 'respond':
            const status = args["status"];
            if (status) {
                returnObj = {
                    statusCode: status
                };
            } else throw new Error('status missing in respond action');
            const respHeaders = args["setRespHeaders"];
            if (respHeaders) {
                try {
                    for (var respHeader in respHeaders) {
                        if (!returnObj.headers) returnObj['headers'] = {};
                        returnObj.headers[respHeader] = {"value": respHeaders[respHeader]};
                    }
                } catch (err) {
                    console.log(err);
                    throw new Error('header directive malformed in action');
                }
            }
            return returnObj;
          case 'canary':
            const dice = Math.random() * 100;
            var selectedAction;
            var cumRange = 0;
            for (let i = 0; i < args.length; i++) {
              cumRange += args[i][0];
              if (dice < cumRange) {
                  selectedAction = args[i][1];
                  break;
              }
            }
            return applyActions(returnObj, selectedAction);
          default:
            throw new Error('invalid action opration');
        }
    } catch (err) {
        console.log(err);
        throw new Error('Error applying action = '+JSON.stringify(actions));
    }
}

function getRand() {
    return rand;
}

