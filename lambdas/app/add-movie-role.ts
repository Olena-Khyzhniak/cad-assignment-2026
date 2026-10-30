import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

  // Validate required fields
  const { movieId, actorId, roleName, roleDescription } = body;
  if (typeof movieId !== 'number' || typeof actorId !== 'number') {
    return response(400, { message: "movieId and actorId must be numbers" });
  }
  if (typeof roleName !== 'string' || typeof roleDescription !== 'string') {
    return response(400, { message: "roleName and roleDescription must be strings" });
  }
  const role: Role = { movieId, actorId, roleName, roleDescription };

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            // Verify the movie exists
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: movieKey(role.movieId), SK: movieKey(role.movieId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            // Verify the actor exists
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: actorKey(role.actorId), SK: actorKey(role.actorId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            // Write the role item; fails if role already exists
            Put: {
              TableName: tableName,
              Item: { PK: movieKey(role.movieId), SK: actorKey(role.actorId), ...role },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      })
    );
    return response(201, { message: "Role added", data: role });
  } catch (err: any) {
    // TransactionCanceledException: movie/actor not found, or role already exists
    if (err.name === 'TransactionCanceledException') {
      const reasons: { Code: string }[] = err.CancellationReasons ?? [];
      if (reasons[0]?.Code === 'ConditionalCheckFailed') {
        return response(404, { message: `Movie ${role.movieId} not found` });
      }
      if (reasons[1]?.Code === 'ConditionalCheckFailed') {
        return response(404, { message: `Actor ${role.actorId} not found` });
      }
      if (reasons[2]?.Code === 'ConditionalCheckFailed') {
        return response(409, { message: "Role for this movie and actor already exists" });
      }
    }
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error", error: err });
  }
};
