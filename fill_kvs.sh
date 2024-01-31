BUCKET_RAW=$(cat outputs.json | jq -r ".CloudfrontRuleEngineStack.s3bucket")
BUCKET=$(echo "s3://$BUCKET_RAW")
KVS_ARN=$(cat outputs.json | jq -r ".CloudfrontRuleEngineStack.kvsarn")
APIA_RAW=$(cat outputs.json | jq -r ".CloudfrontRuleEngineStack.apia")
APIA=${APIA_RAW::${#APIA_RAW}-6}
APIB_RAW=$(cat outputs.json | jq -r ".CloudfrontRuleEngineStack.apib")
APIB=${APIB_RAW::${#APIB_RAW}-6}

ETAG=$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn $KVS_ARN | jq -r ".ETag")

sed "s~___IFMATCH__~$ETAG~g" rules/rules.array | sed "s~___KVSARN___~$KVS_ARN~g" | sed "s~__ORIGIN_S3_BUCKET__~$BUCKET~g" | sed "s~___APIA___~$APIA~g" | sed "s~___APIB___~$APIB~g" > rules.temp

echo "KvsARN: '$KVS_ARN'" > update_keys_config.yaml
echo "IfMatch: '$ETAG'" >> update_keys_config.yaml
echo "Puts:" >> update_keys_config.yaml

for row in $(cat rules.temp | jq -c '.[]'); do
    RULENAME=$(echo $row | jq -c -r '.name')
    RULE=$(echo $row | jq -c -r '.value')
    echo "- Key: '$RULENAME'" >> update_keys_config.yaml
    echo "  Value: '$RULE'" >> update_keys_config.yaml
done

aws cloudfront-keyvaluestore update-keys --cli-input-yaml file://update_keys_config.yaml
rm rules.temp
rm update_keys_config.yaml
rm outputs.json




