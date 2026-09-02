import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
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

  @Post("delivery")
  async delivery(@Body() body: { code?: string }) {
    return { code: 200, data: await this.payment.delivery(body.code || "") };
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
  async notify(
    @Req() request: RawRequest,
    @Res() response: Response,
    @Query() query: { signature?: string; timestamp?: string; nonce?: string; echostr?: string },
    @Headers("content-type") contentType = "",
  ) {
    const rawBody = request.rawBody?.toString("utf8") || request.body || "";
    const body = await this.payment.notify(
      typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
      query,
      contentType,
    );
    if (typeof body === "string") {
      response.setHeader("Content-Type", "application/xml; charset=utf-8");
      return response.send(body);
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    return response.json(body);
  }
}
