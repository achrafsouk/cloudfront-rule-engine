# CloudFront Rule Engine

This solution demonstrates the usage of CloudFront Function to execute rules when processing incoming HTTP requests. Rules are stored in KVS and can be viewed in the rules.array file. This solution allows customers to dyanmically customize the processing of HTTP requests, wihtout changing CloudFront configuration:
* For customers who have requirements for more complex request matching/processing needs that what is possible natively with Cache behaviors, this content will provide a framework to get started quicker in implementing such requirements.
* For customers who has advanced origin routing needs, this content could be also a blue print for such implementations. This is dependent on the release of the origin selection feature in CloudFront functions. Example customer needs:
    * During Cloud  migrations like [TrueCar](https://aws.amazon.com/blogs/networking-and-content-delivery/truecars-dynamic-routing-with-aws-lambdaedge/)
    * Tenant routing like [Outsystems](https://aws.amazon.com/blogs/architecture/dynamic-request-routing-in-multi-tenant-systems-with-amazon-cloudfront/)
    * Routing to multiple Kubernetes clusters either for tenant isolation, multi region deployments, and cellular architectures, [related blog](https://aws.amazon.com/blogs/containers/how-to-leverage-application-load-balancers-advanced-request-routing-to-route-application-traffic-across-multiple-amazon-eks-clusters/)

## Deploy the solution

To deploy the solution, first configure your AWS CLI to us-east 1 region, then exectue the following command lines
```
npm install
cdk deploy --outputs-file outputs.json
bash fill_kvs.sh
```

## Rule engine description

high level description of the code:

```
async function handler(event) {
    var request = event.request
    
    try {
        const rules = await fetchRules();
        const matchingRuleId = getMatchingRuleId(request, rules);
        const matchingRuleActions = await getRuleActions(matchingRuleId);
        return applyRuleActions(request, matchingRuleActions);
        
    } catch (err) {
        console.log(err);
        if (err instanceof EvalError) {
            throw new Error('fail close, request with no matching rule');
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
```

**fetchRules()** to fetch the rule list from KVS. An example list of three rules stored in KVS:
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
**getMatchingRuleId()** Loop through rules to find matching ones. Decide if you want to apply all rules that match, or only the first one that matches.


**getRuleActions()** Fetch the actions of the rule that matched from KVS.  An example rule action:
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
**applyRuleActions()** Finally apply rules to request and return.


CloudFront distribution is only confifigured with one default cache behavior and the S3 origin.


## Roadmap

Remove Lambda@Edge and enable CloudFront Function origin selection when released
Add the possibility of non terminating rule
Add URL actions, such as prefix and suffix:
Add caching controls
Make operation names customizable
Add recommendations for optimzing the code
