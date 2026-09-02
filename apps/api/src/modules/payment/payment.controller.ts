import { Body, Controller, Get, Header, Headers, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { PaymentService } from "./payment.service";

type RawRequest = Request & { rawBody?: Buffer };

@Controller("pay")
export class PaymentController {
  constructor(private readonly payment: PaymentService) {}

  @Get("catalog")
  async catalog(@Headers("x-openid") openid: string) {
    return { code: 200, data: await this.payment.catalog(openid || "") };
  }

  @Post("order")
  async order(@Body() body: { code?: string; productKey?: string }) {
    return { code: 200, data: await this.payment.createOrder(body.code || "", body.productKey || "") };
  }

  @Get("orders/:outTradeNo")
  async orderStatus(@Headers("x-openid") openid: string, @Param("outTradeNo") outTradeNo: string) {
    return { code: 200, data: await this.payment.orderStatus(openid || "", outTradeNo) };
  }

  @Get("notify")
  async verifyNotifyUrl(@Query() query: { signature?: string; timestamp?: string; nonce?: string; echostr?: string }) {
    return await this.payment.verifyNotifyUrl(query);
  }

  @Post("notify")
  @Header("Content-Type", "application/xml")
  async notify(@Req() request: RawRequest, @Query() query: { signature?: string; timestamp?: string; nonce?: string; echostr?: string }) {
    const rawBody = request.rawBody?.toString("utf8") || request.body || "";
    return await this.payment.notify(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody), query);
  }
}
