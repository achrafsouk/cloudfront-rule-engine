# CloudFront Rule Engine

This solution demonstrates the usage of CloudFront Function to execute rules when processing incoming HTTP requests. Rules are stored in KVS and can be viewed in the rules.array file. This solution allows customers to dyanmically customize the processing of HTTP requests, wihtout changing CloudFront configuration.


Configure your AWS CLI to us-east 1 region

npm install
cdk deploy --outputs-file outputs.json
bash fill_kvs.sh


# Roadmap

Add the possibility of non terminating rule
Remove Lambda@Edge and enable CloudFront Function origin selection when released
Add URL actions, such as prefix and suffix

const prefixUri = args["prefixUri"];
if (prefixUri) {
    returnObj.uri = prefixUri + returnObj.uri;
}
    const suffixUri = args["suffixUri"];
if (suffixUri) {
    returnObj.uri = returnObj.uri + suffixUri;
}