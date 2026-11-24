import {
  Mongoose,
  type Connection,
  type ConnectOptions,
  type Query,
  type Schema,
} from 'mongoose';

const readBudgetMs = 10_000;

function readOptions(options: { maxTimeMS?: number; signal?: unknown }) {
  const deadline = AbortSignal.timeout(readBudgetMs);
  return {
    maxTimeMS:
      options.maxTimeMS !== undefined && options.maxTimeMS > 0
        ? Math.min(options.maxTimeMS, readBudgetMs)
        : readBudgetMs,
    signal:
      options.signal instanceof AbortSignal
        ? AbortSignal.any([options.signal, deadline])
        : deadline,
  };
}

export function createAuthTestModelReadConnection(
  uri?: string,
  options?: ConnectOptions,
): Connection {
  // A separate Mongoose instance clones imported schemas before invoking plugins.
  const mongoose = new Mongoose();
  const connection =
    uri === undefined
      ? mongoose.createConnection()
      : mongoose.createConnection(uri, options);
  connection.plugin((schema: Schema) => {
    schema.pre<Query<unknown, unknown>>(
      ['find', 'findOne', 'countDocuments'],
      function () {
        if (this.model.db === connection) {
          this.setOptions(readOptions(this.getOptions()));
        }
      },
    );
    schema.pre('aggregate', function () {
      if (
        this.model().db === connection &&
        !this.pipeline().some((stage) => '$out' in stage || '$merge' in stage)
      ) {
        this.option(readOptions(this.options));
      }
    });
  });
  return connection;
}
