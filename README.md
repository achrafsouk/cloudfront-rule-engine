# Rule Engine demo using CloudFront Functions

In this repo, you can find a example of a rule engine completely implemented using CloudFront Functions. If you have dynamic requirements for sophisiticated for request matching/processing, that can't be met using the native and static path based CloudFront cache behaviors, you can consider this sample code to understand the concept.

The way it works is simple. The CloudFront distribution has a single default cache behavior pointing to an S3 bucket, and a CloudFront Function attached to it on the viewer request, that processes all requests received by CloudFront.

For every processed request, the functions goes through the following steps

``` javascript 
const rules = await fetchRules(); // fetch the rule list from KeyValueStore (KVS).
const matchingRuleId = getMatchingRuleId(request, rules); // Loop through rules to find the first matching one. 
const matchingRuleActions = await getRuleActions(matchingRuleId); // Fetch the actions of the rule that matched from KVS.
return applyRuleActions(request, matchingRuleActions); // Finally apply the rule actions to the request and return.

``` 

## Deploy the demo

Deploy the solution in us-east-1 region, using an EC2 instance or the AWS CloudShell. Execute the following command lines

```
git clone https://github.com/achrafsouk/cloudfront-rule-engine.git
cd cloudfront-rule-engine
npm install
cdk deploy --outputs-file outputs.json
bash fill_kvs.sh
```

The last command, executes a bash script to fill KVS with the rules, based on the template in /rules/rule.array with resource values replaced by the output of the CDK deploy step.

# Origin selection in CloudFront Functions

Since reInvent 2024, CloudFront Functions allows you to [dynamically select the origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/helper-functions-origin-modification.html) using the ```updateRequestOrigin``` method.

I have shared my mental model of Amazon CloudFront in the past: A highly available global reverse proxy, where customers can enable bells and whistles to implement specific requirements. One of the common requirements I come across is routing requests to backends. 

When it's a simple load balancing need, I recommend starting applying Route 53 policies on the backend DNS domain names, that CloudFront will respect when resolving them. However, when the routing logic is more sophisticated, requiring application layer attributes, then using Lambda@Edge becomes mandatory. 

With the origin selection capability made also available in CloudFront functions, backend routing implementation can be now cheaper and faster. Here are common use cases for backend routing:

▶ Cell-based architectures
▶ Multi-region architectures with different routing logic, whether geo based or latency based
▶ Dynamic routing of APIs using a single domain
▶ User-based routing for scenarios such as data residency, routing to the corresponding host in a multi-tenant/SaaS infrastructure, routing to different tiers of service, routing malicious sources to honeypots, etc..
▶ Failover scenarios, ranging from graceful ones, waiting rooms, to active passive setups.
▶ During migrations, e.g. DC to cloud using the strangler pattern.


## Example rules

An example list of three rules stored in KVS:
```
{
            "embargoedCountries": {
                "|": [
                    {
                        "=": {
                            "header": {
                                "cloudfront-viewer-country": "UA"
                            }
                        }
                    },
                    {
                        "=": {
                            "header": {
                                "cloudfront-viewer-country": "FR"
                            }
                        }
                    }
                ]
            },
            "adminRedirect": {
                "&": [
                    {
                        "=": {
                            "uri": "/admin.html"
                        }
                    },
                    {
                        "exist": {
                            "cookie": {
                                "session": "false"
                            }
                        }
                    }
                ]
            },
            "adminAccess": {
                "=": {
                    "uri": "/admin.html"
                }
            },
            "api_a": {
                "startwith": {
                    "uri": "/api/clients"
                }
            },
}
```

An example of a rule action:
```
    {
        "name": "adminRedirect",
        "value": {
            "respond": {
                "status": 307,
                "setRespHeaders": {
                    "location": "/login.html"
                }
            }
        }
    }
```

## TODOs

* Improve the login experience with an endpoint, and automated key generation
* Review and optimize the code
* Rule engine
** Add the possibility of non terminating rule
** Add URL actions, such as prefix and suffix
** Add caching controls
** Make operation names customizable
