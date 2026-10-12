/**
 * Appservice-Endpunkte (§10.1, §15.2). Synapse ruft sie mit dem `hs_token` auf.
 * Wichtigste Regel: nie wegen eines einzelnen Events ablehnen — Synapse stellt
 * streng der Reihe nach zu und ein 4xx blockiert alles dahinter.
 */
import type { FastifyInstance } from 'fastify'
import { checkHsToken, inAliasNamespace, inUserNamespace } from './auth.js'
import { storeTransaction, type InboundEvent } from './transactions.js'
import type { Ctx } from '../context.js'

interface TransactionBody {
  events?: InboundEvent[]
}

export async function appserviceRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.put<{ Params: { txnId: string }; Body: TransactionBody }>(
    '/_matrix/app/v1/transactions/:txnId',
    async (req, reply) => {
      const auth = checkHsToken(req.headers.authorization)
      if (!auth.ok) return reply.code(auth.status).send({ errcode: auth.error })

      const events = Array.isArray(req.body?.events) ? req.body!.events! : []
      try {
        const resultat = await storeTransaction(req.params.txnId, events)
        if (!resultat.duplicate) {
          ctx.log.debug({ txn: req.params.txnId, events: resultat.stored }, 'Transaktion angenommen')
        }
        return reply.code(200).send({})
      } catch (err) {
        // Nur hier darf 503 stehen: Postgres ist weg, Synapse soll es erneut versuchen.
        ctx.log.error({ err, txn: req.params.txnId }, 'Transaktion nicht gespeichert')
        return reply.code(503).send({ errcode: 'M_UNKNOWN', error: 'database unavailable' })
      }
    },
  )

  // Ping in beide Richtungen (§10.1, 7).
  app.post('/_matrix/app/v1/ping', async (req, reply) => {
    const auth = checkHsToken(req.headers.authorization)
    if (!auth.ok) return reply.code(auth.status).send({ errcode: auth.error })
    return reply.code(200).send({})
  })

  // Puppets im exklusiven Namensraum: Synapse fragt, ob es sie gibt (§15.2).
  app.get<{ Params: { userId: string } }>(
    '/_matrix/app/v1/users/:userId',
    async (req, reply) => {
      const auth = checkHsToken(req.headers.authorization)
      if (!auth.ok) return reply.code(auth.status).send({ errcode: auth.error })
      return inUserNamespace(req.params.userId)
        ? reply.code(200).send({})
        : reply.code(404).send({ errcode: 'M_NOT_FOUND' })
    },
  )

  app.get<{ Params: { roomAlias: string } }>(
    '/_matrix/app/v1/rooms/:roomAlias',
    async (req, reply) => {
      const auth = checkHsToken(req.headers.authorization)
      if (!auth.ok) return reply.code(auth.status).send({ errcode: auth.error })
      return inAliasNamespace(req.params.roomAlias)
        ? reply.code(200).send({})
        : reply.code(404).send({ errcode: 'M_NOT_FOUND' })
    },
  )
}
