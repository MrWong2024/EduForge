import { mongo } from 'mongoose';
import { readDeclaredDatabaseName } from './database-purpose';

const localReplicaSet = 'rs0';
const loopbackHosts = ['127.0.0.1', 'localhost', '::1'];

export function isLocalRootMongoReplicaSetUri(
  mongoUri: string | undefined,
  databaseName: string,
): boolean {
  if (
    !mongoUri?.startsWith('mongodb://') ||
    readDeclaredDatabaseName(mongoUri) !== databaseName
  )
    return false;
  try {
    const keys = [...new URL(mongoUri).searchParams.keys()].map((key) =>
      key.toLowerCase(),
    );
    if (
      new Set(keys).size !== keys.length ||
      keys.some((key) => /^(proxy|loadbalanced$|srv|dbname$)/.test(key))
    )
      return false;

    // Constructing a client parses the URI without connecting or authenticating.
    const options = new mongo.MongoClient(mongoUri).options;
    const { credentials, hosts } = options;
    return (
      options.replicaSet === localReplicaSet &&
      hosts.length === 1 &&
      loopbackHosts.includes(hosts[0].host ?? '') &&
      !hosts[0].socketPath &&
      options.dbName === databaseName &&
      credentials?.username === 'root' &&
      credentials.source === 'admin' &&
      credentials.password.length > 0 &&
      ['DEFAULT', 'SCRAM-SHA-1', 'SCRAM-SHA-256'].includes(
        credentials.mechanism,
      ) &&
      Object.keys(credentials.mechanismProperties).length === 0
    );
  } catch {
    // Driver parse errors can include credentials.
    return false;
  }
}

export function readLocalMongoPort(address: unknown): number | undefined {
  if (typeof address !== 'string') return undefined;
  const match =
    /^(?:localhost|127\.0\.0\.1|\[::1\]|\[::ffff:(?:7f00:1|127\.0\.0\.1)\]):([0-9]+)$/i.exec(
      address,
    );
  if (!match) return undefined;
  const port = Number(match[1]);
  return port > 0 && port <= 65535 ? port : undefined;
}

export function isLocalSingleNodeReplicaSetPrimary(
  hello: unknown,
  connectedAddress: string,
): boolean {
  if (!hello || typeof hello !== 'object') return false;
  const port = readLocalMongoPort(connectedAddress);
  return (
    port !== undefined &&
    'setName' in hello &&
    hello.setName === localReplicaSet &&
    'isWritablePrimary' in hello &&
    hello.isWritablePrimary === true &&
    !('msg' in hello && hello.msg === 'isdbgrid') &&
    !('isreplicaset' in hello && hello.isreplicaset === true) &&
    'hosts' in hello &&
    Array.isArray(hello.hosts) &&
    hello.hosts.length === 1 &&
    readLocalMongoPort(hello.hosts[0]) === port &&
    'me' in hello &&
    readLocalMongoPort(hello.me) === port &&
    'primary' in hello &&
    readLocalMongoPort(hello.primary) === port &&
    isEmptyMemberList('passives' in hello ? hello.passives : undefined) &&
    isEmptyMemberList('arbiters' in hello ? hello.arbiters : undefined)
  );
}

function isEmptyMemberList(members: unknown): boolean {
  return (
    members === undefined || (Array.isArray(members) && members.length === 0)
  );
}
