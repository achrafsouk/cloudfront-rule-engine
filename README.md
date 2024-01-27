# CloudFront Rule Engine

Demonstrating a rule engine in CloudFront implemented using KVS and CloudFront Functions

Deploy in us-east 1 only

Example rules

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
                "!": {
                    "exist": {
                        "cookie": {
                            "session": ""
                        }
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
            "uri": "/api/a"
        }
    },
    "api_b": {
        "startwith": {
            "uri": "/api/b"
        }
    },
    "aboutABtesting": {
        "=": {
            "uri": "/about.html"
        }
    },
    "default": {
        "match": {
            "uri": ".*"
        }
    }
}


**Actions of embargoedCountries**
{
    "respond": {
        "status": 403
    }
}

**Actions of default**
{
    "forward": {
        "origin": "s3://originbucket"
    }
}

**Actions of adminRedirect**
{
    "respond": {
        "status": 307,
        "setRespHeaders": {
            "location": "/login.html"
        }
    }
}

test with 

curl -v https://d1w2qld8c51tvs.cloudfront.net/admin.html -H 'cookie:session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJuYmYiOjE1MTYyMzkwMjIsImV4cCI6MTcxNjIzOTAyMn0.jyu6HjS95wU8iSofQ8nBlmPjFYODxn4PQAdFM-Cv8JY'


**Actions of AdminAccess**
{
    "forward": {
        "origin": "s3://originbucket",
        "auth": {
            "key": "LzdWGpAToQ1DqYuzHxE6YOqi7G3X2yvNBot9mCXfx5k"
        }
    }
}

**Actions of apiService1**
{
    "forward": {
        "origin": "api1.example.com",
        "setReqHeaders": {
            "x-secret-key": "lPuzHxE0KOqi7GS34y"
        }
    }
}

**Actions of apiService2**
{
    "forward": {
        "origin": "api2.example.com",
        "setReqHeaders": {
            "x-secret-key": "lPuzHxE0KOqi7GS34y"
        }
    }
}

**Actions of aboutABtesting**
{
    "canary": [
        [
            50,
            {
                "forward": {
                    "origin": "__ORIGIN_S3_BUCKET__",
                    "uri": "/about.html"
                }
            }
        ],
        [
            50,
            {
                "forward": {
                    "origin": "__ORIGIN_S3_BUCKET__",
                    "uri": "/about2.html"
                }
            }
        ]
    ]
}